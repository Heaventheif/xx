"use strict";

// Calculate typing duration based on outgoing text length (capped for speed).
function getTypingDuration(text) {
  if (typeof text !== "string") text = (text && typeof text.body === "string") ? text.body : "";
  if (!text) return 0;
  // 150ms base + 8ms per word, capped at 500ms.
  // Previous cap was 900ms — reduced for snappier feel.
  return Math.min(150 + text.split(/\s+/).length * 8, 500);
}

// Wrap global.safeSend so every outgoing text message shows a typing indicator.
// CHANGED from original:
//   • Removed `getThinkingDelay` artificial wait (was 200ms per response — pure latency).
//   • sendTypingIndicator is now fire-and-forget (no await).
//   • Added `api.sendTypingIndicator` duration hint so the indicator auto-clears.
export default function enhanceBot(api) {
  const originalSafeSend = global.safeSend;

  global.safeSend = async function enhancedSend(apiInstance, body, threadID, callback, messageID) {
    if (!body) return originalSafeSend(apiInstance, body, threadID, callback, messageID);

    const textBody        = typeof body === "string" ? body : (typeof body?.body === "string" ? body.body : "");
    const isAttachmentOnly = typeof body === "object" && !!body?.attachment && !textBody;

    // Skip indicator for attachment-only messages (photos, videos, etc.).
    if (isAttachmentOnly) return originalSafeSend(apiInstance, body, threadID, callback, messageID);

    const typingMs = getTypingDuration(textBody);

    // Fire-and-forget — no await means zero latency penalty.
    // The `duration` hint (Nexus-extended API) lets the server auto-stop typing
    // so we don't need a second call to turn it off.
    if (typingMs > 0) {
      try {
        // Prefer the Nexus extended signature with duration hint.
        if (typeof api.sendTypingIndicator === "function") {
          api.sendTypingIndicator(threadID, true, { duration: typingMs });
        }
      } catch (_) {}

      // Minimal delay (50ms) so the typing bubble renders before the message arrives.
      // This replaces the old 200ms "thinking" delay.
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    return originalSafeSend(apiInstance, body, threadID, callback, messageID);
  };

  console.log("[✅ ENHANCER] محاكاة الكتابة نشطة (بدون تأخير اصطناعي)");
}
