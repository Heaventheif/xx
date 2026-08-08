import http from "../utils/fetchHttp";
import { getHfBase, getInternalToken } from "../utils/hfClient";
import { loadCtx, saveCtx, clearCtx } from "../utils/sharedSession";


const COLLECTION = "gemini_sessions";

// Sanitize a display name for use in the API payload.
function sanitizeName(name) {
  if (!name) return "مستخدم";
  const clean = String(name)
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[[\]{}<>`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
  return clean || "مستخدم";
}

// Call the Gemini proxy endpoint with the conversation messages.
async function callHF(endpoint, messages) {
  const { data } = await http.post(
    `${getHfBase()}/${endpoint}`,
    { messages },
    { timeout: 30000, headers: { "Content-Type": "application/json", "X-Internal-Token": getInternalToken() } }
  );
  if (!data.reply) throw new Error("استجابة فارغة");
  return data.reply;
}

// Handle a Gemini chat request and reply with the model's answer.
async function handle(api, event, prompt, registerReply) {
  const { threadID, messageID, senderID } = event;
  const sessionKey = threadID;

  if (["clear", "مسح", "reset"].includes(prompt.trim().toLowerCase())) {
    await clearCtx(COLLECTION, sessionKey);
    return global.safeSend(api, "🧹 تم مسح ذاكرة المجموعة.", threadID, null, messageID);
  }

  if (!prompt.trim()) {
    return global.safeSend(api,
      "🤖 Gemini AI\n\nأرسل سؤالك مع الأمر\nمثال: .gemini ما هي عاصمة فرنسا؟\n.gemini مسح — لمسح ذاكرة المجموعة",
      threadID, null, messageID
    );
  }

  let senderDisplayName = senderID;
  try {
    const userInfo = await new Promise((res, rej) =>
      api.getUserInfo(senderID, (err, data) => err ? rej(err) : res(data))
    );
    senderDisplayName = userInfo?.[senderID]?.name || senderID;
  } catch (_) {}
  senderDisplayName = sanitizeName(senderDisplayName);

  const ctx = await loadCtx(COLLECTION, sessionKey);
  const userContent = `[${senderDisplayName}]: ${prompt.trim()}`;

  const messages = [
    ...ctx,
    { role: "user", content: userContent },
  ];

  let reply;
  try {
    reply = await callHF("gemini", messages);
  } catch (e) {
    console.error("[GEMINI→HF]", e.response?.status, e.message?.substring(0, 60));
    console.error("[gemini:callHF]", e.message);
    const msg = e.message?.includes("HF_SPACE_URL")
      ? "❌ HF_SPACE_URL غير مضبوط في متغيرات البيئة."
      : "❌ الخادم غير متاح حالياً، حاول لاحقاً.";
    return global.safeSend(api, msg, threadID, null, messageID);
  }

  global.safeSend(api, reply, threadID, (err, info) => {
    if (err || !info) return;
    if (registerReply) {
      // No author restriction — any group member can continue the conversation (shared AI)
      registerReply(info.messageID, {}, async ({ api, event }) => {
        await handle(api, event, event.body?.trim() || "", registerReply);
      });
    }
  }, messageID);

  await saveCtx(COLLECTION, sessionKey, [
    ...ctx,
    { role: "user",      content: userContent },
    { role: "assistant", content: reply },
  ]);
}

export default {
  config: {
    name: "gemini",
    aliases: ["جميناي", "دردشة1"],
    version: "10.0.0",
    author: "Sunken",
    countDown: 5,
    role: 0,
    category: "ذكاء اصطناعي",
    description: "محادثة ذكية جماعية بذاكرة محفوظة — Gemini Flash",
    usage: [
      "{pn}gemini <سؤال> — إرسال سؤال",
      "{pn}gemini مسح — مسح ذاكرة المحادثة الجماعية",
    ],
  },

  onStart: async ({ api, event, args, message }) => {
    const prompt = args.join(" ").trim() || event.messageReply?.body || "";
    await handle(api, event, prompt, message?.registerReply);
  },

  onReply: async ({ api, event, message }) => {
    await handle(api, event, event.body?.trim() || "", message?.registerReply);
  },
};
