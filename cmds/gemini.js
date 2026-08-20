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
  return data; // نُعيد data كاملةً لنستخرج sources أيضاً
}

// Call the /gemini/search endpoint — بحث مباشر بالإنترنت بدون جلسة.
async function callSearch(query) {
  const { data } = await http.post(
    `${getHfBase()}/gemini/search`,
    { query },
    { timeout: 45000, headers: { "Content-Type": "application/json", "X-Internal-Token": getInternalToken() } }
  );
  if (!data.reply) throw new Error("استجابة فارغة");
  return data;
}

// Format sources list into a readable footer (إن وُجدت مصادر بحث).
function formatSources(sources) {
  if (!Array.isArray(sources) || sources.length === 0) return "";
  const list = sources.slice(0, 5).map((s, i) => `${i + 1}. ${s}`).join("\n");
  return `\n\n📎 المصادر:\n${list}`;
}

// Handle a Gemini chat request and reply with the model's answer.
async function handle(api, event, prompt, registerReply) {
  const { threadID, messageID, senderID } = event;
  const sessionKey = threadID;

  // أوامر المسح
  if (["clear", "مسح", "reset"].includes(prompt.trim().toLowerCase())) {
    await clearCtx(COLLECTION, sessionKey);
    return global.safeSend(api, "🧹 تم مسح ذاكرة المجموعة.", threadID, null, messageID);
  }

  // رسالة المساعدة
  if (!prompt.trim()) {
    return global.safeSend(api,
      "🤖 Gemini AI (مع بحث فعلي بالإنترنت)\n\n" +
      "أرسل سؤالك مع الأمر:\n" +
      ".gemini <سؤال> — محادثة ذكية بذاكرة\n" +
      ".gemini مسح — مسح ذاكرة المحادثة\n\n" +
      "🔍 للبحث الفوري بالإنترنت:\n" +
      ".search <سؤال> — بحث مباشر بدون ذاكرة",
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

  let result;
  try {
    result = await callHF("gemini", messages);
  } catch (e) {
    console.error("[GEMINI→HF]", e.response?.status, e.message?.substring(0, 60));
    const msg = e.message?.includes("HF_SPACE_URL")
      ? "❌ HF_SPACE_URL غير مضبوط في متغيرات البيئة."
      : "❌ الخادم غير متاح حالياً، حاول لاحقاً.";
    return global.safeSend(api, msg, threadID, null, messageID);
  }

  const reply = result.reply;
  // أضف مصادر البحث إن وُجدت (Google Search Grounding)
  const sources = formatSources(result.sources);
  const fullReply = reply + sources;

  global.safeSend(api, fullReply, threadID, (err, info) => {
    if (err || !info) return;
    if (registerReply) {
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

// ─── أمر البحث المباشر بالإنترنت ──────────────────────────────────

async function handleSearch(api, event, query) {
  const { threadID, messageID } = event;

  if (!query.trim()) {
    return global.safeSend(api,
      "🔍 بحث فوري بالإنترنت\n\nمثال: .search آخر أخبار الذكاء الاصطناعي",
      threadID, null, messageID
    );
  }

  let result;
  try {
    result = await callSearch(query);
  } catch (e) {
    console.error("[SEARCH→HF]", e.response?.status, e.message?.substring(0, 60));
    return global.safeSend(api, "❌ فشل البحث، حاول لاحقاً.", threadID, null, messageID);
  }

  const sources = formatSources(result.sources);
  const fullReply = `🔍 ${result.reply}${sources}`;
  return global.safeSend(api, fullReply, threadID, null, messageID);
}

export default {
  config: {
    name: "gemini",
    aliases: ["Ai2", "search"],
    version: "11.0.0",
    author: "Sunken",
    countDown: 5,
    role: 0,
    category: "ذكاء اصطناعي",
    description: "محادثة ذكية جماعية بذاكرة محفوظة + بحث فعلي بالإنترنت — Gemini 2.5 Flash",
    usage: [
      "{pn}gemini <سؤال> — إرسال سؤال مع ذاكرة المجموعة",
      "{pn}gemini مسح — مسح ذاكرة المحادثة الجماعية",
      "{pn}search <سؤال> — بحث فوري بالإنترنت بدون ذاكرة",
    ],
  },

  onStart: async ({ api, event, args, message }) => {
    const cmdName = event.command?.toLowerCase() || "";
    const prompt = args.join(" ").trim() || event.messageReply?.body || "";

    // إذا استُدعي كـ .search
    if (cmdName === "search") {
      return handleSearch(api, event, prompt);
    }

    await handle(api, event, prompt, message?.registerReply);
  },

  onReply: async ({ api, event, message }) => {
    await handle(api, event, event.body?.trim() || "", message?.registerReply);
  },
};
