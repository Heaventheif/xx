"use strict";

// Rate-limited, safe message sending — every outgoing send goes through a
// per-thread queue so we never spam a thread faster than MIN_SEND_GAP_MS.
// Exposed on `global` (global.safeSend / global.wrapApiForSafety /
// global.cleanupIdleThreadGates) since command files across the project
// call these as globals rather than importing this module directly.
//
// CHANGED from original:
//   • MIN_SEND_GAP_MS: 350 → 200ms (Facebook allows faster successive sends;
//     the original 350ms was overly conservative).
//   • Added global.prioritySend: bypasses queue for urgent system messages
//     (e.g. error replies, permission warnings) — sends immediately with a
//     100ms gap instead of joining the full queue.

const MIN_SEND_GAP_MS      = 200; // normal inter-message gap per thread
const PRIORITY_SEND_GAP_MS = 100; // gap for priority (system) messages

const _threadGates = new Map();

// Internal: enforce the minimum gap between sends to the same thread.
function _gate(key, gapMs) {
  let gate = _threadGates.get(key);
  if (!gate) {
    gate = { promise: Promise.resolve(), lastSendAt: 0 };
    _threadGates.set(key, gate);
  }
  return gate;
}

// Normal rate-limited send — joins the per-thread queue.
function gatedSend(api, body, threadID, callback, messageID) {
  const rawApi = api.__rawApi || api;
  const key    = String(threadID);
  const gate   = _gate(key, MIN_SEND_GAP_MS);

  const resultPromise = gate.promise.then(async () => {
    const wait = MIN_SEND_GAP_MS - (Date.now() - gate.lastSendAt);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    gate.lastSendAt = Date.now();
    if (messageID !== undefined) return await rawApi.sendMessage(body, threadID, callback, messageID);
    return await rawApi.sendMessage(body, threadID, callback);
  });

  gate.promise = resultPromise.catch(e => { console.error("[SEND] خطأ:", e.message); });
  return resultPromise;
}

// Priority send — for system messages (errors, permission warnings).
// Skips ahead of any queued messages but still enforces a 100ms gap.
function prioritySend(api, body, threadID, callback, messageID) {
  const rawApi = api.__rawApi || api;
  const key    = String(threadID);
  const gate   = _gate(key, PRIORITY_SEND_GAP_MS);

  return new Promise(async (resolve, reject) => {
    const wait = PRIORITY_SEND_GAP_MS - (Date.now() - gate.lastSendAt);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    gate.lastSendAt = Date.now();
    try {
      const result = messageID !== undefined
        ? await rawApi.sendMessage(body, threadID, callback, messageID)
        : await rawApi.sendMessage(body, threadID, callback);
      resolve(result);
    } catch (e) {
      console.error("[PRIORITY_SEND] خطأ:", e.message);
      reject(e);
    }
  });
}

function cleanupIdleThreadGates() {
  const now     = Date.now();
  let   removed = 0;
  for (const [tid, g] of _threadGates.entries()) {
    if (now - g.lastSendAt > 30 * 60 * 1000) { _threadGates.delete(tid); removed++; }
  }
  return removed;
}

const _wrappedApiCache = new WeakMap();

// Wrap the raw Facebook API so all sends go through the safe/gated sender.
function wrapApiForSafety(api) {
  if (_wrappedApiCache.has(api)) return _wrappedApiCache.get(api);
  const wrapped = Object.create(api);
  wrapped.__rawApi     = api;
  wrapped.sendMessage  = (body, threadID, callback, messageID) =>
    global.safeSend(api, body, threadID, callback, messageID);
  _wrappedApiCache.set(api, wrapped);
  return wrapped;
}

global.safeSend              = gatedSend;
global.prioritySend          = prioritySend;
global.wrapApiForSafety      = wrapApiForSafety;
global.cleanupIdleThreadGates = cleanupIdleThreadGates;

export { gatedSend, prioritySend, wrapApiForSafety, cleanupIdleThreadGates };
