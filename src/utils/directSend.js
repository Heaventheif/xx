"use strict";
const PART_GAP_MS = 400;
const _lastSent = new Map();
async function _throttle(threadID) {
  const key = String(threadID);
  const last = _lastSent.get(key) || 0;
  const wait = PART_GAP_MS - (Date.now() - last);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _lastSent.set(key, Date.now());
}
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
const PART_RETRY_ATTEMPTS = 3;
const PART_RETRY_DELAY_MS = 1500;
async function directSendParts(api, threadID, title, streams, replyToID = undefined) {
  const total = streams.length;
  let sent = 0;
  const failedParts = [];
  for (let i = 0; i < total; i++) {
    const partLabel = total > 1 ? ` (جزء ${i + 1}/${total})` : "";
    const body = `📥 ${title || "تم التحميل"}${partLabel}`;
    const stream = streams[i]?.stream ?? streams[i];
    let ok = false;
    for (let attempt = 1; attempt <= PART_RETRY_ATTEMPTS && !ok; attempt++) {
      const attemptStream = (attempt > 1 && typeof streams[i]?.reopen === "function")
        ? streams[i].reopen()
        : stream;
      ok = await directSend(api, threadID, { body, attachment: attemptStream }, replyToID);
      if (!ok && attempt < PART_RETRY_ATTEMPTS) {
        console.warn(`[DIRECT_SEND] إعادة محاولة الجزء ${i + 1}/${total} (محاولة ${attempt + 1}/${PART_RETRY_ATTEMPTS})`);
        await new Promise(r => setTimeout(r, PART_RETRY_DELAY_MS * attempt));
      }
    }
    if (ok) {
      sent++;
    } else {
      failedParts.push(i + 1);
      console.warn(`[DIRECT_SEND] فشل إرسال الجزء ${i + 1}/${total} نهائياً بعد ${PART_RETRY_ATTEMPTS} محاولات`);
    }
  }
  if (failedParts.length > 0) {
    const note = `⚠️ فشل إرسال ${failedParts.length} من ${total} جزء (الأجزاء: ${failedParts.join(", ")}) — ${title || ""}`.trim();
    await directSend(api, threadID, note, replyToID).catch(() => {});
  }
  return { sent, failedParts, total };
}
export { directSend, directSendParts };
