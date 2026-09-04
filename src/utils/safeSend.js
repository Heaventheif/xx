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
function gatedSend(api, body, threadID, callback, messageID) {
  const rawApi = api.__rawApi || api;
  const key    = String(threadID);
  const gate   = _gate(key, MIN_SEND_GAP_MS);
  const resultPromise = gate.promise.then(async () => {
    const wait = MIN_SEND_GAP_MS - (Date.now() - gate.lastSendAt);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    if (rawApi.__stealth) await rawApi.__stealth.waitIfNeeded();
    gate.lastSendAt = Date.now();
    const result = messageID !== undefined
      ? await rawApi.sendMessage(body, threadID, callback, messageID)
      : await rawApi.sendMessage(body, threadID, callback);
    rawApi.__stealth?.recordRequest();
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
    if (rawApi.__stealth) await rawApi.__stealth.waitIfNeeded();
    gate.lastSendAt = Date.now();
    const result = messageID !== undefined
      ? await rawApi.sendMessage(body, threadID, callback, messageID)
      : await rawApi.sendMessage(body, threadID, callback);
    rawApi.__stealth?.recordRequest();
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
export { gatedSend, prioritySend, wrapApiForSafety, cleanupIdleThreadGates };
