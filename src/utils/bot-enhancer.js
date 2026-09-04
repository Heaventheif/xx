"use strict";

// مدة الكتابة غير حتمية: تتغير بناءً على عدد الكلمات + جيتر عشوائي ± 35%
// هذا يمنع خوارزميات الكشف من رصد نمط ثابت "N كلمة = N ms"
function getTypingDuration(text) {
  if (typeof text !== "string") text = (text && typeof text.body === "string") ? text.body : "";
  if (!text) return 0;
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  // سرعة الكتابة الأساسية: 140–220 حرف/دقيقة (تشبه الإنسان)
  const charsPerMs  = (140 + Math.random() * 80) / 60000;
  const rawMs       = Math.max(text.length / charsPerMs, wordCount * 60);
  // حد أدنى 90ms وأقصى 700ms
  return Math.min(Math.max(Math.round(rawMs), 90), 700);
}

// نسبة إرسال مؤشر الكتابة: ~78% من الرسائل فقط (لا 100%)
// الباقي يُرسَل بدون مؤشر لمحاكاة البشر الذين لا يكتبون دائماً ببطء
const TYPING_INDICATOR_PROBABILITY = 0.78;

export default function enhanceBot() {
  // [FIX P1] idempotent: لا نُغلّف أكثر من مرة بغض النظر عن عدد الحسابات
  if (global.safeSend.__humanized) return;

  const baseSend = global.safeSend;
  const enhancedSend = async function enhancedSend(apiInstance, body, threadID, callback, messageID) {
    if (!body) return baseSend(apiInstance, body, threadID, callback, messageID);
    const textBody         = typeof body === "string" ? body : (typeof body?.body === "string" ? body.body : "");
    const isAttachmentOnly = typeof body === "object" && !!body?.attachment && !textBody;
    if (isAttachmentOnly) return baseSend(apiInstance, body, threadID, callback, messageID);

    const typingMs = getTypingDuration(textBody);
    // [FIX P1] نستخدم apiInstance (الحساب الفعلي للرسالة) بدل المرجع المغلق
    const shouldSendIndicator =
      typingMs > 0 &&
      Math.random() < TYPING_INDICATOR_PROBABILITY &&
      typeof apiInstance?.sendTypingIndicator === "function";

    if (shouldSendIndicator) {
      try {
        apiInstance.sendTypingIndicator(threadID, true, { duration: typingMs });
      } catch (err) {
        console.warn("[ENHANCER] sendTypingIndicator فشل:", err?.message);
      }
      // تأخير صغير عشوائي قبل الإرسال (لا يُساوي دائماً 50ms)
      await new Promise(resolve => setTimeout(resolve, 20 + Math.random() * 60));
    }
    return baseSend(apiInstance, body, threadID, callback, messageID);
  };

  enhancedSend.__humanized = true;
  global.safeSend = enhancedSend;
  console.log("[✅ ENHANCER] محاكاة الكتابة نشطة (إيقاع بشري غير متوقع)");
}
