"use strict";
/**
 * chat.js — دردشة AI عبر UnoRouter
 * متوافق مع بنية xx-bot (Context, sharedSession, safeSend, registerReply)
 * يدعم 80+ نموذج مجاني مع fallback تلقائي
 */

import { loadCtx, saveCtx, clearCtx } from "../../utils/sharedSession.js";

const BASE       = "https://api.unorouter.com/v1";
const API_KEY    = process.env.UNOROUTER_API_KEY;   // ← أضفه في Render → Environment
const COLLECTION = "unochat_sessions";
const MAX_HISTORY   = 10;
const TIMEOUT_MS    = 45_000;

// ── كل النماذج المجانية مرتبة بالأولوية ────────────────────────────────────
const FREE_MODELS = [
  // GLM 5.3 — أعلى نسبة نجاح وأوسع سياق
  "glm-5.3-search:free",
  "glm-5.3-think-search:free",
  "glm-5.3-flash-search:free",
  "glm-5.3-flash-thinking:free",
  "glm-5.3-thinking:free",
  "glm-5.3-flash:free",
  "glm-5.3:free",

  // GLM 5.2 / 4.x
  "glm-5.2-search:free",
  "glm-5.2-think-search:free",
  "glm-5.2-thinking:free",
  "glm-5.2:free",
  "glm-4.7-flash:free",
  "glm-4.6v-flash:free",

  // DeepSeek
  "deepseek-v4-flash:free",
  "deepseek-v4-pro:free",

  // GPT (OpenAI OSS)
  "gpt-5.5:free",
  "gpt-5.4:free",
  "gpt-oss-120b:free",
  "gpt-oss-20b:free",

  // Qwen
  "qwen3.8-flash-next:free",
  "qwen3.8-27b:free",
  "qwen3.5-397b-a17b:free",
  "qwen3.5-122b-a10b:free",
  "qwen3.6-35b-a3b:free",
  "qwen3.6-27b:free",
  "qwen3.5-4b:free",
  "qwen3-next-80b-a3b-instruct:free",
  "qwen3-30b-a3b:free",
  "qwen2.5-vl-7b-instruct-awq:free",
  "qwen-sea-lion-v4-32b-it:free",
  "qwen-sea-lion-v4.5-27b-it:free",

  // Nemotron
  "nemotron-3-ultra-550b-a55b:free",
  "nemotron-3-super-120b-a12b:free",
  "nemotron-3-nano-omni-30b-a3b:free",
  "nemotron-3.5-lightning-30b-a3b:free",
  "nemotron-3.5-lightning:free",
  "nemotron-nano-12b-v2-vl:free",
  "nemotron-nano-9b-v2:free",
  "mistral-nemotron:free",

  // Gemini / Gemma
  "gemini-3.7-flash-free:free",
  "gemini-3.6-flash:free",
  "gemini-3.5-flash-lite:free",
  "gemini-3.1-flash-lite:free",
  "gemini-2.5-flash:free",
  "gemini-flash-lite:free",
  "gemma-4-31b-it:free",
  "gemma-4-26b:free",
  "gemma-sea-lion-v4-27b:free",
  "diffusiongemma-26b-a4b-it:free",

  // MiniMax
  "minimax-m2.7:free",

  // Step
  "step-3.7-flash:free",

  // Ling
  "ling-3.0-flash-fin:free",
  "ling-3.0-flash-sante:free",

  // LLaMA
  "llama-4-maverick-17b-128e-instruct:free",
  "llama-3.2-11b-vision:free",
  "llama-3.2-3b:free",
  "llama-3.2-1b:free",
  "llama-3.1-8b:free",

  // Mistral
  "mistral-large-3-675b:free",
  "mistral-small-3.2:free",
  "mistral-small:free",

  // Intern (InternLM / InternVL)
  "internvl3.5-241b-a28b:free",
  "internvl3.5-latest:free",
  "internvl-latest:free",
  "intern-s2-preview-397b:free",
  "intern-s2-preview-35b:free",
  "intern-s2-preview:free",
  "intern-s1-pro:free",
  "intern-s1-mini:free",
  "intern-s1:free",
  "intern-latest:free",

  // Nex
  "nex-n2.5-pro:free",
  "nex-n2.5-mini:free",
  "north-mini-code:free",

  // Sonar / Perplexity-style
  "sonar:free",

  // Laguna / Mercury
  "laguna-s-2.1:free",
  "laguna-xs-2.1:free",
  "mercury-2:free",

  // Manta
  "manta-flash-1.0:free",
  "manta-mini-1.0:free",

  // Muse / Muse glimmer
  "muse-glimmer-30b:free",

  // Codestral / Coding
  "codestral-latest:free",

  // Compound
  "compound:free",
  "compound-mini:free",

  // Allam
  "allam-2-7b:free",

  // LFM
  "lfm-2.5-2.6b:free",

  // Leanstral
  "leanstral-1-5:free",

  // Seed OSS
  "seed-oss-36b:free",

  // Sensenova
  "sensenova-6.8-flash-lite:free",

  // Typhoon
  "typhoon-v2.5-30b-a3b-instruct:free",

  // Sapphira / L3 variants
  "sapphira-l3.3-70b-0.1:free",
  "l3-70b-euryale-v2.1:free",
  "l3-8b-stheno-v3.2:free",
  "l3.3-ms-nevoria-70b:free",

  // MN Violet Lotus
  "mn-violet-lotus-12b:free",

  // Aion
  "aion-3.0:free",
  "aion-rp-llama-3.1-8b:free",

  // Kat-Coder
  "kat-coder-air-v1:free",

  // Sarvam
  "sarvam-30b:free",

  // Villanova
  "villanova-2b-2512-preview:free",

  // Granite
  "granite-4.0-micro:free",

  // Dots
  "dots-3-note-preview:free",

  // Ising
  "ising-calibration-1.5-31b:free",

  // Gemini Robotics
  "gemini-robotics-er-2-preview:free",
];

// ── خرائط النماذج للاختيار اليدوي ──────────────────────────────────────────
const MODEL_ALIASES = {
  // GLM
  "glm":          "glm-5.3:free",
  "glm5":         "glm-5.3:free",
  "glm5s":        "glm-5.3-search:free",
  "glm5f":        "glm-5.3-flash:free",
  "glm5t":        "glm-5.3-thinking:free",
  "glm4":         "glm-4.7-flash:free",
  // DeepSeek
  "deepseek":     "deepseek-v4-flash:free",
  "ds":           "deepseek-v4-flash:free",
  "dspro":        "deepseek-v4-pro:free",
  // Qwen
  "qwen":         "qwen3.8-flash-next:free",
  "qwen3":        "qwen3.5-397b-a17b:free",
  // GPT
  "gpt":          "gpt-5.5:free",
  "gpt5":         "gpt-5.5:free",
  // Gemini / Gemma
  "gemini":       "gemini-3.7-flash-free:free",
  "gemma":        "gemma-4-31b-it:free",
  // Nemotron
  "nemotron":     "nemotron-3-ultra-550b-a55b:free",
  "nemo":         "nemotron-3-ultra-550b-a55b:free",
  // Mistral
  "mistral":      "mistral-large-3-675b:free",
  // LLaMA
  "llama":        "llama-4-maverick-17b-128e-instruct:free",
  // Intern
  "intern":       "internvl3.5-241b-a28b:free",
  // MiniMax
  "minimax":      "minimax-m2.7:free",
  // Step
  "step":         "step-3.7-flash:free",
  // Ling
  "ling":         "ling-3.0-flash-fin:free",
  // Sonar
  "sonar":        "sonar:free",
  // Codestral
  "code":         "codestral-latest:free",
  "coder":        "codestral-latest:free",
};

// ── حالة الوضع التلقائي لكل مجموعة ─────────────────────────────────────────
const _activeMap = new Map();
const _modelMap  = new Map();

const COLLECTION_ACTIVE = "unochat_active";
const CMD_ON  = ["on",  "تفعيل", "شغل",  "يلا"];
const CMD_OFF = ["off", "إيقاف", "وقف",  "سكت", "اسكت"];
const BOT_CMD_PREFIXES = [".", "/", "!", "#", "-"];
const SYSTEM_TRIGGERS  = ["chat ", "ai ", "ذكاء "];

// ── دوال الحالة ─────────────────────────────────────────────────────────────
async function isActive(threadID) {
  if (_activeMap.has(threadID)) return _activeMap.get(threadID);
  const state = await loadCtx(COLLECTION_ACTIVE, threadID, 1);
  const val = Array.isArray(state) ? false : state?.active === true;
  _activeMap.set(threadID, val);
  return val;
}
async function setActive(threadID, value) {
  _activeMap.set(threadID, value);
  await saveCtx(COLLECTION_ACTIVE, threadID, { active: value });
}

// ── الدالة الأساسية: تجرب النماذج واحداً تلو الآخر ────────────────────────
async function ask(messages, preferredModel = null) {
  if (!API_KEY) return "❌ لم يتم ضبط UNOROUTER_API_KEY في متغيرات Render.";

  const models = preferredModel
    ? [preferredModel, ...FREE_MODELS.filter(m => m !== preferredModel)]
    : FREE_MODELS;

  for (const model of models) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const res = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          temperature: 0.7,
          max_tokens: 1024,
        }),
      });
      clearTimeout(timer);

      if (res.status === 429 || res.status >= 500) continue;
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${txt.slice(0, 120)}`);
      }
      const json = await res.json();
      const content = json?.choices?.[0]?.message?.content;
      if (content) return `${content.trim()}\n\n🤖 _${model}_`;
    } catch (e) {
      if (e.name === "AbortError" || e.message?.includes("5") || e.message?.includes("429")) continue;
      // خطأ غير متوقع — ننتقل للتالي
      continue;
    }
  }
  return "⚠️ كل النماذج المجانية مشغولة حالياً، حاول بعد دقيقة.";
}

// ── معالج الرسائل الرئيسي ───────────────────────────────────────────────────
async function handleMessage(api, event, message, prompt, registerReply) {
  const { threadID, messageID, senderID } = event;
  const lower = prompt.trim().toLowerCase();

  // مسح الذاكرة
  if (["clear", "مسح", "reset", "امسح"].includes(lower)) {
    await clearCtx(COLLECTION, threadID);
    return message.reply("🧹 تم مسح ذاكرة المحادثة.");
  }

  // تفعيل/إيقاف الوضع التلقائي
  if (CMD_ON.includes(lower)) {
    await setActive(threadID, true);
    return message.reply(
      "✅ تم تفعيل الوضع التلقائي!\n" +
      "البوت سيرد على كل رسالة في الغروب.\n" +
      "لإيقافه: .chat off"
    );
  }
  if (CMD_OFF.includes(lower)) {
    await setActive(threadID, false);
    return message.reply("⛔ تم إيقاف الوضع التلقائي.");
  }

  // عرض النماذج
  if (["models", "نماذج", "list"].includes(lower)) {
    const current = _modelMap.get(threadID) ?? "تلقائي (أفضل متاح)";
    const aliases = Object.entries(MODEL_ALIASES)
      .map(([k, v]) => `• .chat set ${k}  →  ${v}`)
      .join("\n");
    return message.reply(
      `🤖 النماذج المتاحة (${FREE_MODELS.length} نموذج):\n\n${aliases}\n\n📌 الحالي: ${current}`
    );
  }

  // تغيير النموذج: .chat set <alias>
  const setMatch = lower.match(/^set\s+(.+)$/);
  if (setMatch) {
    const alias = setMatch[1].trim().toLowerCase();
    if (alias === "reset" || alias === "auto") {
      _modelMap.delete(threadID);
      return message.reply("🔄 تم إعادة تعيين النموذج للترتيب التلقائي.");
    }
    const model = MODEL_ALIASES[alias] ?? (FREE_MODELS.includes(`${alias}:free`) ? `${alias}:free` : null);
    if (!model) {
      const keys = Object.keys(MODEL_ALIASES).join(", ");
      return message.reply(`❓ نموذج غير معروف: "${alias}"\n\nالمختصرات المتاحة:\n${keys}`);
    }
    _modelMap.set(threadID, model);
    return message.reply(`✅ تم تغيير النموذج إلى: ${model}`);
  }

  // لا يوجد سؤال
  if (!prompt.trim()) {
    return message.reply("✍️ اكتب سؤالك: .chat <سؤال>\nأو .chat models لعرض النماذج");
  }

  // بناء تاريخ المحادثة
  const rawHistory = await loadCtx(COLLECTION, threadID, MAX_HISTORY * 2) || [];
  const history = Array.isArray(rawHistory) ? rawHistory : [];

  const messages_payload = [
    { role: "system", content: "أنت مساعد مفيد وذكي. أجب بإيجاز ووضوح." },
    ...history,
    { role: "user", content: prompt },
  ];

  // إرسال مؤشر "يفكر"
  const thinkMsg = await message.reply("⏳ جارٍ التفكير…");

  try {
    const preferred = _modelMap.get(threadID) ?? null;
    const reply = await ask(messages_payload, preferred);

    // تحديث التاريخ
    const updatedHistory = [
      ...history,
      { role: "user",      content: prompt },
      { role: "assistant", content: reply  },
    ].slice(-(MAX_HISTORY * 2));
    await saveCtx(COLLECTION, threadID, updatedHistory);

    // حذف رسالة "يفكر" وإرسال الرد
    try { api.unsendMessage(thinkMsg?.messageID, threadID, () => {}); } catch (_) {}

    const info = await message.reply(reply);

    // تسجيل الرد للمتابعة
    if (registerReply && info?.messageID) {
      registerReply(info.messageID, { threadID }, async ({ api: a, event: e, message: m }) => {
        const followUp = (e.body || "").trim();
        if (!followUp) return;
        await handleMessage(a, e, m, followUp, registerReply);
      }, senderID);
    }
  } catch (e) {
    try { api.unsendMessage(thinkMsg?.messageID, threadID, () => {}); } catch (_) {}
    return message.reply(`❌ خطأ: ${e.message}`);
  }
}

// ── تصدير الأمر ─────────────────────────────────────────────────────────────
export default {
  config: {
    name: "chat",
    aliases: ["uno"],
    version: "2.0.0",
    author: "sunken",
    countDown: 3,
    role: 0,
    usePrefix: true,
    category: "ذكاء اصطناعي",
    description: `دردشة ذكاء اصطناعي عبر UnoRouter (${FREE_MODELS.length}+ نموذج مجاني) مع ذاكرة جماعية ورد تلقائي`,
    usage: [
      "{pn}chat <سؤالك>          — بدء محادثة",
      "{pn}chat on/off           — تفعيل/إيقاف الرد التلقائي",
      "{pn}chat set <نموذج>      — تغيير النموذج (glm5/deepseek/qwen/gpt/gemini/...)",
      "{pn}chat set reset        — إعادة تعيين النموذج للتلقائي",
      "{pn}chat models           — عرض جميع النماذج المتاحة",
      "{pn}chat مسح              — مسح ذاكرة المحادثة",
    ],
  },

  // ── أمر مباشر: .chat <سؤال> ───────────────────────────────────────────────
  onStart: async ({ api, event, args, message }) => {
    const prompt = args.join(" ").trim() || (event.messageReply?.body ?? "");
    await handleMessage(api, event, message, prompt, message?.registerReply);
  },

  // ── مستمع التريقر بدون prefix أو الوضع التلقائي ──────────────────────────
  onChat: async ({ api, event, message }) => {
    const { body, threadID } = event;
    const text  = (body || "").trim();
    const lower = text.toLowerCase();

    if (!text) return;

    // تريقر بالاسم بدون prefix: "chat سؤال" أو "ai سؤال"
    const trigger = SYSTEM_TRIGGERS.find(t => lower.startsWith(t));
    if (trigger) {
      const prompt = text.slice(trigger.trim().length).trim();
      return handleMessage(api, event, message, prompt, message?.registerReply);
    }

    // الوضع التلقائي
    if (await isActive(threadID)) {
      if (BOT_CMD_PREFIXES.some(p => text.startsWith(p))) return;
      if (text.length < 2) return;
      return handleMessage(api, event, message, text, message?.registerReply);
    }
  },
};

// ─── Plugin Descriptor ──────────────────────────────────────────────────────
/** @type {import('../../core/plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: "xx-commands-ai-chat",
  meta: { category: "command-ai", path: "src/commands/ai/chat.js" },
  setup(_ctx) {
    // provides: chat command via UnoRouter (80+ free models)
  },
};
