"use strict";


// Minimum gap between consecutive sends to the same thread (ms).
const PART_GAP_MS = 400;

// Tracks last send timestamp per thread to enforce the gap.
const _lastSent = new Map();

// Wait the required gap between two sends to the same thread.
async function _throttle(threadID) {
  const key = String(threadID);
  const last = _lastSent.get(key) || 0;
  const wait = PART_GAP_MS - (Date.now() - last);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _lastSent.set(key, Date.now());
}

// Send a message directly via rawApi, bypassing the safeSend queue.
// Returns true on success, false on failure (error logged).
async function directSend(api, threadID, messageBody, replyToID = undefined) {
  const rawApi = api.__rawApi || api;
  await _throttle(threadID);
  return new Promise((resolve) => {
    const cb = (err) => {
      if (err) {
        console.error("[DIRECT_SEND] خطأ:", err?.message?.substring(0, 120));
        resolve(false);
      } else {
        resolve(true);
      }
    };
    try {
      if (replyToID) {
        rawApi.sendMessage(messageBody, threadID, cb, replyToID);
      } else {
        rawApi.sendMessage(messageBody, threadID, cb);
      }
    } catch (e) {
      console.error("[DIRECT_SEND] استثناء:", e?.message?.substring(0, 120));
      resolve(false);
    }
  });
}

// Send multi-part media in order with a part label (Part N/T).
// streams: array of ReadStream or { stream, ext } per part.
// Returns the number of parts successfully sent.
async function directSendParts(api, threadID, title, streams, replyToID = undefined) {
  const total = streams.length;
  let sent = 0;

  for (let i = 0; i < total; i++) {
    const partLabel = total > 1 ? ` (جزء ${i + 1}/${total})` : "";
    const body = `📥 ${title || "تم التحميل"}${partLabel}`;
    const stream = streams[i]?.stream ?? streams[i];

    const ok = await directSend(
      api,
      threadID,
      { body, attachment: stream },
      replyToID
    );
    if (ok) sent++;
    else console.warn(`[DIRECT_SEND] فشل إرسال الجزء ${i + 1}/${total}`);
  }

  return sent;
}

export { directSend, directSendParts };
