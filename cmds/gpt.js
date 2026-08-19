import http from "../utils/fetchHttp";
import { loadCtx, saveCtx, clearCtx } from "../utils/sharedSession";

const COLLECTION = "cerebras_sessions";
const CEREBRAS_KEY = process.env.CEREBRAS_API_KEY;

const SYSTEM = `أنت "Sunken"، صاحب في غروب.
- رد بطريقة غير رسمية
- اقصر ما يمكن — جملة واحدة أو جملتين كافية
- بلا عناوين، بلا نقاط، بلا تنسيق
- إذا السؤال غبي رد بنكتة قصيرة
- إذا جاك صورة/صوت/فيديو وصفه مباشرة بلا مقدمات`;

const MODELS = {
  "120b": "gpt-oss-120b",
  "20b":  "gpt-oss-20b",
  // New: llama3.3 via Cerebras ultra-fast inference
  "llama": "llama-3.3-70b",
};
const DEFAULT_MODEL = "gpt-oss-120b";

// Call the Cerebras-backed GPT endpoint with the conversation messages.
async function callCerebras(messages, model = DEFAULT_MODEL) {
  if (!CEREBRAS_KEY) throw new Error("CEREBRAS_API_KEY غير مضبوط في ENV");

  const { data } = await http.post(
    "https://api.cerebras.ai/v1/chat/completions",
    {
      model,
      messages,
      max_completion_tokens: 1024,
      temperature: 0.7,
      top_p: 1,
      stream: false,
    },
    {
      headers: {
        "Authorization": `Bearer ${CEREBRAS_KEY}`,
        "Content-Type":  "application/json",
      },
      timeout: 30000,
    }
  );

  const reply = data?.choices?.[0]?.message?.content;
  if (!reply) throw new Error("استجابة فارغة من Cerebras");
  return reply;
}

// Handle a GPT chat request and reply with the model's answer.
async function handle(api, event, args, registerReply) {
  const { threadID, messageID, senderID } = event;
  const sessionKey = threadID;

  let model = DEFAULT_MODEL;
  let promptParts = [...args];

  if (promptParts[0] && MODELS[promptParts[0].toLowerCase()]) {
    model = MODELS[promptParts.shift().toLowerCase()];
  }

  const prompt = promptParts.join(" ").trim();

  if (["clear", "مسح", "reset"].includes(prompt.toLowerCase())) {
    await clearCtx(COLLECTION, sessionKey);
    return global.safeSend(api, "🧹 تم مسح ذاكرة المجموعة.", threadID, null, messageID);
  }

  if (!prompt) {
    return global.safeSend(api,
      "❓ اكتب سؤالك!\n" +
      "مثال: .gpt ما هي عاصمة فرنسا؟\n" +
      ".gpt 20b سؤالك — لاستخدام النموذج الأصغر\n" +
      ".gpt llama سؤالك — Llama 3.3 70B\n" +
      ".gpt مسح — لمسح ذاكرة المجموعة",
      threadID, null, messageID
    );
  }

  let statusMsgId = null;
  try {
    const sent = await new Promise((resolve, reject) =>
      global.safeSend(api, "⚡ جاري المعالجة بـ Cerebras...", threadID, (err, info) => err ? reject(err) : resolve(info), messageID)
    );
    statusMsgId = sent?.messageID;
  } catch (_) {}

  const updateStatus = async (text) => {
    try { if (statusMsgId) await api.editMessage(text, statusMsgId); } catch (_) {}
  };

  const ctx = await loadCtx(COLLECTION, sessionKey);

  let senderDisplayName = senderID;
  try {
    const userInfo = await new Promise((res, rej) =>
      api.getUserInfo(senderID, (err, data) => err ? rej(err) : res(data))
    );
    senderDisplayName = userInfo?.[senderID]?.name || senderID;
  } catch (_) {}

  const userContent = `[${senderDisplayName}]: ${prompt}`;

  const messages = [
    { role: "system", content: SYSTEM },
    ...ctx,
    { role: "user", content: userContent },
  ];

  let reply;
  try {
    reply = await callCerebras(messages, model);
  } catch (e) {
    console.error("[CEREBRAS]", e.response?.status, e.message?.substring(0, 80));
    const errMsg = e.message.includes("ENV")
      ? "❌ CEREBRAS_API_KEY غير مضبوط في المتغيرات."
      : "❌ الخادم غير متاح حالياً، حاول لاحقاً.";
    return updateStatus(errMsg);
  }

  await updateStatus(reply);

  if (statusMsgId && registerReply) {
    // No author restriction — any group member can continue the conversation (shared AI)
    registerReply(statusMsgId, {}, async ({ api, event }) => {
      await handle(api, event, [event.body?.trim() || ""], registerReply);
    });
  }

  await saveCtx(COLLECTION, sessionKey, [
    ...ctx,
    { role: "user",      content: userContent },
    { role: "assistant", content: reply },
  ]);
}

export default {
  config: {
    name: "gpt",
    aliases: ["Ai3"],
    version: "3.0.0",
    author: "Sunken",
    countDown: 3,
    role: 0,
    category: "ذكاء اصطناعي",
    description: "محادثة ذكية جماعية — Cerebras GPT OSS 120B / Llama 3.3",
    usage: [
      "{pn}gpt <سؤالك> — محادثة عادية (120B)",
      "{pn}gpt 20b <سؤالك> — نموذج أصغر وأسرع",
      "{pn}gpt llama <سؤالك> — Llama 3.3 70B",
      "{pn}gpt مسح — مسح ذاكرة المحادثة الجماعية",
    ],
  },

  onStart: async ({ api, event, args, message }) => {
    await handle(api, event, args, message?.registerReply);
  },

  onReply: async ({ api, event, message }) => {
    await handle(api, event, [event.body?.trim() || ""], message?.registerReply);
  },
};
