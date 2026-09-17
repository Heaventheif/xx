"use strict";
const MIN_SEND_GAP_MS      = 200; 
const PRIORITY_SEND_GAP_MS = 100; 
const _threadGates = new Map();
function _gate(key, gapMs) {
  let gate = _threadGates.get(key);
  if (!gate) {
    gate = { promise: Promise.resolve(), lastSendAt: 0 };
    _threadGates.set(key, gate);
  }
  return gate;
}
const MAX_FB_MSG_LEN = 19_500; // Facebook hard-limit ~20 000; keep margin

/**
 * Split a long string into chunks ≤ MAX_FB_MSG_LEN characters.
 * Tries to break at the last newline within the window to avoid mid-word cuts.
 */
function splitMessage(text) {
  if (text.length <= MAX_FB_MSG_LEN) return [text];
  const parts = [];
  let start = 0;
  while (start < text.length) {
    let end = start + MAX_FB_MSG_LEN;
    if (end < text.length) {
      // Prefer splitting at the last newline in the window
      const lastNl = text.lastIndexOf("\n", end);
      if (lastNl > start) end = lastNl + 1;
    }
    parts.push(text.slice(start, end));
    start = end;
  }
  return parts;
}

function gatedSend(api, body, threadID, callback, messageID) {
  // Auto-split messages that exceed Facebook's character limit.
  // Only applies to plain-text bodies; objects with attachments pass through.
  if (typeof body === "string" && body.length > MAX_FB_MSG_LEN) {
    const parts = splitMessage(body);
    console.warn(`[SEND] ⚠️ رسالة طويلة (${body.length} حرف) — تُقسَّم إلى ${parts.length} جزء.`);
    // Send all parts sequentially; only attach the callback to the last one
    let chain = Promise.resolve();
    parts.forEach((part, i) => {
      const isLast = i === parts.length - 1;
      chain = chain.then(() =>
        _gatedSendRaw(api, part, threadID, isLast ? callback : undefined, isLast ? messageID : undefined)
      );
    });
    return chain;
  }
  return _gatedSendRaw(api, body, threadID, callback, messageID);
}
function _gatedSendRaw(api, body, threadID, callback, messageID) {
  const rawApi = api.__rawApi || api;
  const key    = String(threadID);
  const gate   = _gate(key, MIN_SEND_GAP_MS);
  const resultPromise = gate.promise.then(async () => {
    const wait = MIN_SEND_GAP_MS - (Date.now() - gate.lastSendAt);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    if (rawApi.__stealth) {
      try {
        // timeout 25s لمنع StealthMode من تجميد الإرسال لفترة طويلة جداً
        await Promise.race([
          rawApi.__stealth.waitIfNeeded(),
          new Promise(r => setTimeout(r, 25_000)),
        ]);
      } catch (_) {}
    }
    gate.lastSendAt = Date.now();
    const result = messageID !== undefined
      ? await rawApi.sendMessage(body, threadID, callback, messageID)
      : await rawApi.sendMessage(body, threadID, callback);
    rawApi.__stealth?.recordRequest?.();
    return result;
  });
  gate.promise = resultPromise.catch(e => { console.error("[SEND] خطأ:", e.message); });
  return resultPromise;
}
function prioritySend(api, body, threadID, callback, messageID) {
  // [FIX P1] نُسلسل على gate.promise تماماً كـ gatedSend لمنع التداخل
  const rawApi = api.__rawApi || api;
  const key    = String(threadID);
  const gate   = _gate(key, PRIORITY_SEND_GAP_MS);
  const resultPromise = gate.promise.then(async () => {
    const wait = PRIORITY_SEND_GAP_MS - (Date.now() - gate.lastSendAt);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    if (rawApi.__stealth) {
      try {
        await Promise.race([
          rawApi.__stealth.waitIfNeeded(),
          new Promise(r => setTimeout(r, 25_000)),
        ]);
      } catch (_) {}
    }
    gate.lastSendAt = Date.now();
    const result = messageID !== undefined
      ? await rawApi.sendMessage(body, threadID, callback, messageID)
      : await rawApi.sendMessage(body, threadID, callback);
    rawApi.__stealth?.recordRequest?.();
    return result;
  });
  // الطابور يكمل حتى لو فشلت عملية بالأولوية (لا يُجمّد السلسلة)
  gate.promise = resultPromise.catch(e => { console.error("[PRIORITY_SEND] خطأ:", e.message); });
  return resultPromise;
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

// Auto-schedule cleanup every 30 min — prevents _threadGates from growing
// unbounded when the bot is in many groups over a long uptime period.
setInterval(() => {
  const removed = cleanupIdleThreadGates();
  if (removed > 0) console.log(`[SEND] 🧹 أُزيل ${removed} gate خامل من الذاكرة.`);
}, 30 * 60 * 1000);
export { gatedSend, prioritySend, wrapApiForSafety, cleanupIdleThreadGates };

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-utils-safe-send',
  meta: { category: 'utils', path: 'src/utils/safeSend.js' },
  setup(_ctx) {
    // provides: cleanupIdleThreadGates, gatedSend, prioritySend, wrapApiForSafety
  },
};
