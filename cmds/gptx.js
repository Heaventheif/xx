"use strict";

import http from "../utils/fetchHttp";
import { loadCtx, saveCtx, clearCtx } from "../utils/sharedSession";

// ─── Constants ───────────────────────────────────────────────────────────────
const COLLECTION        = "gptx_sessions";
const COLLECTION_ACTIVE = "gptx_active";   // Stores which threads have auto-reply on
const BASE_URL          = "https://ceddsrestapi.vercel.app";
const MAX_HISTORY       = 6;   // Max conversation turns kept in memory (user+bot pairs)
const TIMEOUT_MS        = 45000;

const SYSTEM_TRIGGERS = ["gptx ", "gptx", "ai ", "ذكاء "];

// Commands that toggle auto-reply mode for the whole thread
const CMD_ON  = ["on",  "تفعيل", "شغل",  "يلا"];
const CMD_OFF = ["off", "إيقاف", "وقف",  "سكت", "اسكت"];

// Prefixes that indicate a bot command — skip them in auto-reply mode
// to avoid the bot responding to other command prefixes like .help, /ban, etc.
const BOT_CMD_PREFIXES = [".", "/", "!", "#", "-"];

// ─── Endpoint definitions ─────────────────────────────────────────────────────
//
// Using POST for all endpoints — avoids URL length limits that break long
// Arabic prompts and history context (Arabic encodes at ~3x URL size).
// Ordered from best to weakest model quality.
// Response field confirmed from live API testing: "result".
//
const TEXT_ENDPOINTS = [
  // Tier 1 — frontier / flagship models
  { name: "overchat-claude",   path: "/ai/overchat-claude",   bodyKey: "message" },
  { name: "overchat-deepseek", path: "/ai/overchat-deepseek", bodyKey: "message" },
  { name: "overchat-qwen",     path: "/ai/overchat-qwen",     bodyKey: "message" },
  // Tier 2 — GPT-4o class
  { name: "overchat",          path: "/ai/overchat",          bodyKey: "message" },
  // Tier 3 — lighter / fallback models
  { name: "aichatting",        path: "/ai/aichatting",        bodyKey: "message", extra: { model: "gpt-4o-mini" } },
  { name: "youai",             path: "/ai/youai",             bodyKey: "query"   },
  { name: "feloai",            path: "/ai/feloai",            bodyKey: "query"   },
];

// Image-capable endpoints — send both text and image URL in the POST body
const IMAGE_ENDPOINTS = [
  { name: "chipp",    path: "/ai/chipp",    bodyKey: "message", imgKey: "url"       },
  { name: "deepchat", path: "/ai/deepchat", bodyKey: "text",    imgKey: "image_url" },
];

const REPLY_KEYS = ["result", "reply", "answer", "response"];

// ─── نظام اختيار النموذج ─────────────────────────────────────────────────────
//
// _modelMap: threadID → اسم endpoint المختار (مفتاح في MODEL_ALIASES)
// إذا لم يُحدَّد نموذج، يُستعمل الترتيب الافتراضي في TEXT_ENDPOINTS.
//
const _modelMap = new Map(); // threadID → endpoint name

const MODEL_ALIASES = {
  // كلود
  "claude":           "overchat-claude",
  "كلود":             "overchat-claude",
  // ديب سيك
  "deepseek":         "overchat-deepseek",
  "ديب سيك":          "overchat-deepseek",
  "ديبسيك":           "overchat-deepseek",
  // كوين
  "qwen":             "overchat-qwen",
  "كوين":             "overchat-qwen",
  // جي بي تي
  "gpt":              "overchat",
  "gpt4o":            "overchat",
  "gpt-4o":           "overchat",
  "جيبيتي":           "overchat",
  // جي بي تي ميني
  "mini":             "aichatting",
  "gpt-4o-mini":      "aichatting",
  // youai / feloai
  "youai":            "youai",
  "feloai":           "feloai",
};

const MODEL_DISPLAY = {
  "overchat-claude":   "Claude 🧠",
  "overchat-deepseek": "DeepSeek 🔵",
  "overchat-qwen":     "Qwen 🟠",
  "overchat":          "GPT-4o 🟢",
  "aichatting":        "GPT-4o Mini ⚡",
  "youai":             "YouAI 🌐",
  "feloai":            "FeloAI 🌀",
};

// يُعيد قائمة endpoints مع تقديم النموذج المختار
function getOrderedEndpoints(threadID) {
  const chosen = _modelMap.get(threadID);
  if (!chosen) return TEXT_ENDPOINTS;
  const primary = TEXT_ENDPOINTS.find(e => e.name === chosen);
  if (!primary) return TEXT_ENDPOINTS;
  return [primary, ...TEXT_ENDPOINTS.filter(e => e.name !== chosen)];
}



// تنظيف الرد من الرموز الغريبة
function cleanReply(text) {
  if (!text) return text;
  return text
    .replace(/@DONE@/gi, '')
    .replace(/@\w+@/g, '')
    .replace(/(-=\s*|\s*=-)+/g, ' ')
    .replace(/\*{2,}/g, '')
    .replace(/_{2,}/g, '')
    .replace(/#{1,6}\s*/g, '')
    .replace(/[-=]{3,}/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── In-memory fallbacks (تعمل حتى بدون MongoDB) ─────────────────────────────
const _activeMap  = new Map(); // threadID → boolean
const _historyMap = new Map(); // threadID → messages[]

// ─── Auto-reply state helpers ─────────────────────────────────────────────────

async function isActive(threadID) {
  // أولاً: تحقق من الذاكرة المحلية (فورية وتعمل دائماً)
  if (_activeMap.has(threadID)) return _activeMap.get(threadID);
  // ثانياً: حاول من DB إن كان متاحاً
  const state = await loadCtx(COLLECTION_ACTIVE, threadID);
  const val   = Array.isArray(state) ? false : state?.active === true;
  _activeMap.set(threadID, val);
  return val;
}

async function setActive(threadID, value) {
  _activeMap.set(threadID, value); // دائماً في الذاكرة أولاً
  await saveCtx(COLLECTION_ACTIVE, threadID, { active: value }); // DB إن أمكن
}

// History helpers مع in-memory fallback
async function loadHistory(threadID) {
  if (_historyMap.has(threadID)) return _historyMap.get(threadID);
  const h = (await loadCtx(COLLECTION, threadID)) || [];
  _historyMap.set(threadID, h);
  return h;
}

async function saveHistory(threadID, history) {
  _historyMap.set(threadID, history);
  await saveCtx(COLLECTION, threadID, history);
}

async function clearHistory(threadID) {
  _historyMap.delete(threadID);
  _activeMap.delete(threadID);
  await clearCtx(COLLECTION, threadID);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Extract the reply text from an API response object, trying multiple field names.
function extractReply(data, replyKeys) {
  for (const key of replyKeys) {
    if (data?.[key] && typeof data[key] === "string" && data[key].trim()) {
      return data[key].trim();
    }
  }
  // Some APIs wrap the reply in a nested object
  if (data?.data) return extractReply(data.data, replyKeys);
  return null;
}

// Call a single endpoint via POST and return the text reply or throw on failure.
async function callEndpoint(endpoint, msg, imgUrl = null) {
  // Build the POST body using the endpoint's declared field names
  const body = { ...(endpoint.extra || {}), [endpoint.bodyKey]: msg };
  if (imgUrl && endpoint.imgKey) body[endpoint.imgKey] = imgUrl;

  const { data } = await http.post(
    `${BASE_URL}${endpoint.path}`,
    body,
    { timeout: TIMEOUT_MS, headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" } }
  );

  const reply = extractReply(data, REPLY_KEYS);
  if (!reply) throw new Error(`[${endpoint.name}] استجابة فارغة أو حقل غير معروف`);
  return reply;
}

// ─── تحميل الصورة وتحويلها لـ base64 data URL ────────────────────────────────
//
// روابط فيسبوك (scontent.xxx) لا تُقبَل مباشرة من الـ APIs الخارجية.
// الحل: نحمّل الصورة على الخادم ونحوّلها لـ base64 data URL.
//
async function fetchImageAsDataUrl(url) {
  try {
    const response = await http.get(url, {
      timeout: 15000,
      responseType: "arraybuffer",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://www.facebook.com/",
      },
    });
    const buffer   = Buffer.from(response.data);
    const mimeType = response.headers?.["content-type"] || "image/jpeg";
    const base64   = buffer.toString("base64");
    return `data:${mimeType};base64,${base64}`;
  } catch (e) {
    console.warn("[GPTX] فشل تحميل الصورة:", e.message?.substring(0, 80));
    return null; // نرجع null ونستعمل الرابط الأصلي كبديل
  }
}

// Try all endpoints in order and return the first successful reply.
async function callWithFallback(endpoints, msg, imgUrl = null) {
  const errors = [];
  for (const ep of endpoints) {
    try {
      return await callEndpoint(ep, msg, imgUrl);
    } catch (e) {
      errors.push(`${ep.name}: ${e.message?.substring(0, 80)}`);
      console.warn(`[GPTX] ${ep.name} failed:`, e.message?.substring(0, 120));
    }
  }
  throw new Error("فشلت جميع الـ endpoints:\n" + errors.join("\n"));
}

// Detect an image attachment from the incoming event (message or reply).
function detectImageUrl(event) {
  const sources = [
    ...(event.attachments || []),
    ...(event.messageReply?.attachments || []),
  ];
  for (const att of sources) {
    if (!att) continue;
    const type = (att.type || att.attachmentType || "").toLowerCase();
    if (["photo", "image", "sticker", "animated_image"].includes(type)) {
      const url =
        att.largePreviewUrl || att.previewUrl ||
        att.largePreviewUri || att.previewUri ||
        att.url || att.uri || att.thumbnailUrl;
      if (url) return url;
    }
  }
  return null;
}

// إرسال الرسالة مباشرة للـ API بدون system prompt أو سياق إضافي
function buildPromptWithHistory(_history, newPrompt) {
  return newPrompt;
}

// ─── Main handler ──────────────────────────────────────────────────────────────

async function handleMessage(api, event, message, prompt, registerReply) {
  const { threadID, messageID, senderID } = event;

  const lowerPrompt = prompt.trim().toLowerCase();

  // ── gptx set <model> — تغيير النموذج للغرفة ─────────────────────────────
  const setMatch = lowerPrompt.match(/^set\s+(.+)$/);
  if (setMatch) {
    const alias    = setMatch[1].trim().toLowerCase();
    const endpName = MODEL_ALIASES[alias];
    if (!endpName) {
      const list = Object.keys(MODEL_ALIASES)
        .filter(k => /^[a-z]/.test(k)) // نظهر الأسماء الإنجليزية فقط
        .join(", ");
      return message.reply(`❓ نموذج غير معروف: "${alias}"\n\nالنماذج المتاحة:\n${list}`);
    }
    _modelMap.set(threadID, endpName);
    return message.reply(
      `✅ تم تغيير النموذج إلى: ${MODEL_DISPLAY[endpName]}\n` +
      `gptx set claude  — للعودة لكلود\n` +
      `gptx set reset   — للترتيب الافتراضي (أفضل متاح)`
    );
  }

  // ── gptx set reset — إعادة الترتيب الافتراضي ────────────────────────────
  if (lowerPrompt === "set reset" || lowerPrompt === "reset model") {
    _modelMap.delete(threadID);
    return message.reply("🔄 تم إعادة تعيين النموذج للترتيب الافتراضي.");
  }

  // ── gptx models — عرض النماذج المتاحة ──────────────────────────────────
  if (lowerPrompt === "models" || lowerPrompt === "نماذج") {
    const current = _modelMap.get(threadID);
    const lines   = Object.entries(MODEL_DISPLAY).map(([k, v]) =>
      `${current === k ? "✅" : "•"} ${v}  →  gptx set ${TEXT_ENDPOINTS.find(e=>e.name===k)?.name?.replace("overchat-","") ?? k}`
    );
    return message.reply(`🤖 النماذج المتاحة:\n\n${lines.join("\n")}\n\nالحالي: ${MODEL_DISPLAY[current] ?? "افتراضي (أفضل متاح)"}`);
  }

  // Handle "on" command — enable auto-reply for this thread
  if (CMD_ON.includes(lowerPrompt)) {
    await setActive(threadID, true);
    return message.reply(
      "✅ تم تفعيل الوضع التلقائي!\n" +
      "البوت سيرد على كل رسالة في الغروب.\n" +
      "لإيقافه: gptx off"
    );
  }

  // Handle "off" command — disable auto-reply for this thread
  if (CMD_OFF.includes(lowerPrompt)) {
    await setActive(threadID, false);
    return message.reply(
      "⛔ تم إيقاف الوضع التلقائي.\n" +
      "البوت سيرد فقط عند استدعائه صراحةً."
    );
  }

  // Handle clear command
  if (lowerPrompt === "clear" || lowerPrompt === "مسح" || lowerPrompt === "reset") {
    await clearHistory(threadID);
    return message.reply("🧹 تم مسح ذاكرة المجموعة.");
  }

  const imageUrl = detectImageUrl(event);
  if (!prompt && !imageUrl) return message.reply("⚠️ اكتب سؤالاً أو ردّ على صورة.");

  // Load conversation history (in-memory أولاً، ثم DB)
  const history = await loadHistory(threadID);

  // Build the final message to send to the API
  const imageOnlyPrompt = `شوف هذه الصورة وعلق عليها بجملة واحدة قصيرة بالدارجة الجزائرية كيما تعلق على صورة صاحبك، بلا إيموجي.`;

  const finalPrompt = prompt
    ? buildPromptWithHistory(history, prompt)
    : imageOnlyPrompt;

  // الـ endpoints المرتّبة حسب النموذج المختار للغرفة
  const orderedTextEp = getOrderedEndpoints(threadID);

  let reply;
  try {
    if (imageUrl) {
      // نحمّل الصورة ونحوّلها لـ base64 لتجاوز قيود روابط فيسبوك
      const dataUrl     = await fetchImageAsDataUrl(imageUrl);
      const effectiveUrl = dataUrl ?? imageUrl; // base64 أو الرابط الأصلي كبديل

      const imgFallbackMsg = prompt
        ? `${finalPrompt}\n[رابط الصورة: ${effectiveUrl}]`
        : `${imageOnlyPrompt}\n[رابط الصورة: ${effectiveUrl}]`;

      try {
        reply = await callWithFallback(IMAGE_ENDPOINTS, finalPrompt, effectiveUrl);
      } catch (_imgErr) {
        // إذا فشلت كل image endpoints، نضمّ الصورة في النص
        reply = await callWithFallback(orderedTextEp, imgFallbackMsg);
      }
    } else {
      reply = await callWithFallback(orderedTextEp, finalPrompt);
    }
  } catch (e) {
    console.error("[GPTX] All endpoints failed:", e.message);
    return message.reply(`❌ ${e.message}`);
  }

  // تنظيف الرد من الرموز الغريبة قبل الإرسال
  reply = cleanReply(reply);

  // Persist conversation history
  const updatedHistory = [
    ...history,
    { role: "user",      content: prompt || "[صورة]" },
    { role: "assistant", content: reply  },
  ].slice(-(MAX_HISTORY * 2));
  await saveHistory(threadID, updatedHistory);

  // Send the reply and register follow-up listener
  const info = await message.reply(reply);
  if (registerReply) {
    registerReply(info.messageID, { threadID }, async ({ api, event, message }) => {
      const followUp = event.body?.trim() || "";
      if (!followUp && !event.attachments?.length) return;
      await handleMessage(api, event, message, followUp, registerReply);
    });
  }
}

// ─── Command export ───────────────────────────────────────────────────────────

export default {
  config: {
    name: "gptx",
    aliases: ["Ai"],
    version: "4.1.0",
    author: "Sunken",
    countDown: 3,
    role: 0,
    usePrefix: false,
    category: "ذكاء اصطناعي",
    description: "GPT-4o بذاكرة جماعية، ردود تلقائية، ويفهم الصور — مدعوم بـ CEDDS APIs",
    usage: [
      "{pn}Ai2 <سؤالك> — بدء محادثة",
      "{pn}Ai2 on — تفعيل الرد التلقائي على كل رسالة",
      "{pn}Ai2 off — إيقاف الرد التلقائي",
      "{pn}Ai2 set deepseek — تغيير النموذج (claude/deepseek/qwen/gpt/mini)",
      "{pn}Ai2 models — عرض النماذج المتاحة",
      "رد على صورة + Ai2 — يحلل الصورة",
      "{pn}Ai2 مسح — مسح ذاكرة المحادثة الجماعية",
    ],
  },

  // Command entry point: forward the prompt to the main handler.
  onStart: async ({ api, event, args, message }) => {
    let prompt = args.join(" ").trim();
    if (!prompt && event.messageReply) prompt = event.messageReply.body || "";
    await handleMessage(api, event, message, prompt, message?.registerReply);
  },

  // Respond to every message when auto-reply mode is active,
  // or only when a known trigger word is used otherwise.
  onChat: async ({ api, event, message }) => {
    const { body, threadID } = event;

    const text  = (body || "").trim();
    const lower = text.toLowerCase();

    // هل توجد صورة في الرسالة الحالية أو المُقتبسة؟
    const hasImage = !!detectImageUrl(event);

    // تجاهل الرسالة إذا لا نص ولا صورة (مثلاً: ملف صوتي، sticker ...)
    if (!text && !hasImage) return;

    // ── trigger صريح: يعمل دائماً بغض النظر عن وضع auto-reply ──
    const trigger = SYSTEM_TRIGGERS.find((t) => lower.startsWith(t));
    if (trigger) {
      const prompt = text.slice(trigger.trim().length).trim();
      return handleMessage(api, event, message, prompt, message?.registerReply);
    }

    // ── صورة مع trigger: "gptx صف هذه الصورة" يُعالج أعلاه
    // ── صورة فقط (بدون نص) + trigger ضمني: "gptx" وحده + صورة ──
    // هذه الحالة تُغطّيها handleMessage لأن prompt يكون "" وهناك imageUrl

    // ── وضع الرد التلقائي: يرد على كل شيء ──
    if (await isActive(threadID)) {
      // تخطّ أوامر البوتات الأخرى
      if (text && BOT_CMD_PREFIXES.some((p) => text.startsWith(p))) return;
      // تخطّ الضوضاء القصيرة جداً (emoji واحد، إلخ) — إلا إذا فيها صورة
      if (!hasImage && text.length < 2) return;
      return handleMessage(api, event, message, text, message?.registerReply);
    }
  },
};
