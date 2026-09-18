"use strict";
/**
 * tts2.js — Gemini TTS مباشر
 * ─────────────────────────────────────────────────────────────────
 * متغير البيئة المطلوب:
 *   TTS=AIzaSyXXXXXXXXXX,AIzaSyYYYYYYYY,AIzaSyZZZZZZZZ
 *   (مفاتيح Gemini مفصولة بفواصل)
 *
 * الميزات:
 *   • تدوير المفاتيح Round-Robin عند كل طلب
 *   • تدوير الأصوات عشوائياً عند كل طلب
 *   • Rate Limit ذكي: توقف مؤقت عند 429 وانتقال فوري للمفتاح التالي
 *   • Token Bucket لكل مفتاح (10 طلبات / دقيقة)
 *   • Cooldown تلقائي 60 ثانية عند حظر المفتاح
 *   • جميع الأصوات الرسمية من Gemini TTS API
 */

import fs   from "fs-extra";
import os   from "os";
import path from "path";

// ─── قائمة الأصوات الرسمية من Gemini TTS ─────────────────────────────────
// قائمة الأصوات الرسمية — 30 صوتاً (توثيق Google، 2 سبتمبر 2026)
const VOICES = [
  // Bright
  "Zephyr", "Autonoe",
  // Upbeat
  "Puck", "Laomedeia",
  // Informative
  "Charon", "Rasalgethi",
  // Firm
  "Kore", "Orus", "Alnilam",
  // Excitable
  "Fenrir",
  // Youthful
  "Leda",
  // Easy-going
  "Aoede", "Callirrhoe", "Umbriel",
  // Breathy
  "Enceladus",
  // Clear
  "Iapetus", "Erinome",
  // Smooth
  "Algieba", "Despina",
  // Gravelly
  "Algenib",
  // Soft
  "Achernar",
  // Even
  "Schedar",
  // Mature
  "Gacrux",
  // Forward
  "Pulcherrima",
  // Friendly
  "Achird",
  // Casual
  "Zubenelgenubi",
  // Gentle
  "Vindemiatrix",
  // Lively
  "Sadachbia",
  // Knowledgeable
  "Sadaltager",
  // Warm
  "Sulafat",
];

// ─── نظام إدارة المفاتيح ─────────────────────────────────────────────────

class KeyManager {
  constructor(keys) {
    if (!keys || keys.length === 0) {
      throw new Error("TTS: لا توجد مفاتيح Gemini. أضف TTS=key1,key2,... في متغيرات البيئة.");
    }
    // حالة كل مفتاح
    this._keys = keys.map(k => ({
      key:        k,
      // Token Bucket: 10 طلبات / دقيقة لكل مفتاح
      tokens:     10,
      lastRefill: Date.now(),
      maxTokens:  10,
      refillMs:   60_000,       // كل دقيقة
      // حالة الحظر
      blocked:    false,
      blockUntil: 0,
      // إحصاءات
      uses:       0,
      errors:     0,
    }));
    this._cursor = 0;           // Round-Robin pointer
    this._voiceCursor = 0;      // Voice rotation pointer
  }

  // ── تحديث Token Bucket للمفتاح ─────────────────────────────────
  _refill(state) {
    const now     = Date.now();
    const elapsed = now - state.lastRefill;
    if (elapsed >= state.refillMs) {
      const refills    = Math.floor(elapsed / state.refillMs);
      state.tokens     = Math.min(state.maxTokens, state.tokens + refills);
      state.lastRefill = now;
    }
  }

  // ── هل المفتاح جاهز؟ ───────────────────────────────────────────
  _isReady(state) {
    if (state.blocked && Date.now() < state.blockUntil) return false;
    if (state.blocked && Date.now() >= state.blockUntil) {
      // انتهى الحظر — أعد التهيئة
      state.blocked    = false;
      state.tokens     = state.maxTokens;
      state.lastRefill = Date.now();
      console.log(`[TTS2] 🔓 المفتاح ...${state.key.slice(-6)} جاهز مجدداً`);
    }
    this._refill(state);
    return state.tokens > 0;
  }

  /**
   * احصل على مفتاح جاهز للاستخدام (Round-Robin + Token Bucket)
   * @returns {{ key: string, state: object } | null}
   */
  acquire() {
    const n = this._keys.length;
    for (let attempt = 0; attempt < n; attempt++) {
      const idx   = this._cursor % n;
      this._cursor = (this._cursor + 1) % n;
      const state = this._keys[idx];
      if (this._isReady(state)) {
        state.tokens--;
        state.uses++;
        return { key: state.key, state, idx };
      }
    }
    // جميع المفاتيح محظورة — احسب أقرب وقت انتهاء حظر
    const minWait = this._keys.reduce((min, s) => {
      const wait = s.blocked ? Math.max(0, s.blockUntil - Date.now()) : 0;
      return Math.min(min, wait);
    }, Infinity);
    return { key: null, waitMs: minWait === Infinity ? 60_000 : minWait };
  }

  /**
   * أبلغ عن خطأ 429 — احظر المفتاح لمدة cooldownMs
   * @param {object} state
   * @param {number} [retryAfterMs=65000] - من رأس Retry-After
   */
  reportRateLimit(state, retryAfterMs = 65_000) {
    state.blocked    = true;
    state.blockUntil = Date.now() + retryAfterMs;
    state.tokens     = 0;
    state.errors++;
    console.warn(
      `[TTS2] ⏸️  مفتاح ...${state.key.slice(-6)} محظور لمدة ${Math.ceil(retryAfterMs / 1000)}ث`
    );
  }

  /** الصوت التالي في قائمة التدوير */
  nextVoice() {
    const v          = VOICES[this._voiceCursor % VOICES.length];
    this._voiceCursor = (this._voiceCursor + 1) % VOICES.length;
    return v;
  }

  /** ملخص حالة جميع المفاتيح */
  statusText() {
    return this._keys.map((s, i) => {
      const ready   = this._isReady(s) ? "✅" : "⏸️";
      const waitSec = s.blocked
        ? `(${Math.ceil(Math.max(0, s.blockUntil - Date.now()) / 1000)}ث)` : "";
      return `${ready} مفتاح ${i + 1}: ${s.tokens}/${s.maxTokens} توكن | ${s.uses} طلب ${waitSec}`;
    }).join("\n");
  }

  get totalKeys() { return this._keys.length; }
}

// ─── تهيئة KeyManager مرة واحدة عالمياً ──────────────────────────────────
function getKeyManager() {
  if (global._tts2KeyManager) return global._tts2KeyManager;

  const raw  = (process.env.TTS || "").trim();
  const keys = raw
    .split(",")
    .map(k => k.trim())
    .filter(k => k.length > 10);

  if (keys.length === 0) return null;

  global._tts2KeyManager = new KeyManager(keys);
  console.log(`[TTS2] ✅ ${keys.length} مفتاح Gemini تم تحميلهم`);
  return global._tts2KeyManager;
}

// ─── استدعاء Gemini TTS API ───────────────────────────────────────────────
/**
 * @param {string} text   - النص المراد تحويله
 * @param {string} voice  - اسم الصوت
 * @param {string} apiKey - مفتاح Gemini
 * @returns {Promise<Buffer>} - بيانات الصوت PCM/WAV
 */
async function callGeminiTTS(text, voice, apiKey) {
  const url  = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent?key=${apiKey}`;
  const body = JSON.stringify({
    contents: [{
      role:  "user",
      parts: [{ text }],
    }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: voice },
        },
      },
    },
  });

  const res = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal:  AbortSignal.timeout(60_000),
  });

  // التعامل مع Rate Limit
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("Retry-After") || "65", 10);
    const err        = new Error(`RATE_LIMIT:${retryAfter * 1000}`);
    err.isRateLimit  = true;
    err.retryAfterMs = retryAfter * 1000;
    throw err;
  }

  // خطأ 500 موثَّق رسمياً: النموذج يُعيد أحياناً text tokens بدل audio tokens
  // Google توصي بـ retry تلقائي — نرمي خطأ خاص ليتعامل معه fetchTTS
  if (res.status === 500) {
    const err        = new Error("SERVER_500_RETRY");
    err.isRetryable  = true;
    throw err;
  }

  if (!res.ok) {
    const body2 = await res.text().catch(() => "");
    throw new Error(`Gemini TTS: HTTP ${res.status} — ${body2.slice(0, 200)}`);
  }

  const json = await res.json();

  // استخراج الصوت من الاستجابة
  const audioB64 =
    json?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!audioB64) {
    // قد تُعيد النموذج text tokens عشوائياً — retry
    const err       = new Error("SERVER_500_RETRY");
    err.isRetryable = true;
    throw err;
  }

  return Buffer.from(audioB64, "base64");
}

/**
 * تجربة الطلب مع تدوير المفاتيح التلقائي عند 429
 * يجرب جميع المفاتيح الجاهزة قبل الاستسلام
 */
async function fetchTTS(manager, text, voice) {
  // نجرب مفاتيح متعددة، وعند خطأ 500 نُعيد المحاولة على نفس المفتاح (حتى 3 مرات)
  // لأن Google وثّقت أن 500 يحدث عشوائياً بسبب text tokens بدل audio tokens
  const MAX_KEY_ATTEMPTS  = manager.totalKeys + 1;
  const MAX_500_RETRIES   = 3;

  for (let attempt = 0; attempt < MAX_KEY_ATTEMPTS; attempt++) {
    const ticket = manager.acquire();

    if (!ticket.key) {
      // جميع المفاتيح محظورة
      const waitSec = Math.ceil(ticket.waitMs / 1000);
      throw new Error(`⏳ جميع مفاتيح Gemini محظورة مؤقتاً. حاول بعد ${waitSec} ثانية.`);
    }

    const { key, state } = ticket;

    // retry داخلي لخطأ 500 على نفس المفتاح
    for (let retry = 0; retry < MAX_500_RETRIES; retry++) {
      try {
        const audioBuffer = await callGeminiTTS(text, voice, key);
        return audioBuffer;
      } catch (e) {
        if (e.isRateLimit) {
          // 429 — احظر المفتاح وانتقل للتالي فوراً
          manager.reportRateLimit(state, e.retryAfterMs);
          break;   // اخرج من حلقة retry واذهب للمفتاح التالي
        }
        if (e.isRetryable) {
          // 500 عشوائي — أعد المحاولة على نفس المفتاح
          console.warn(`[TTS2] ⚠️ خطأ 500 عشوائي (retry ${retry + 1}/${MAX_500_RETRIES})...`);
          if (retry < MAX_500_RETRIES - 1) continue;
          // استنفدنا المحاولات على هذا المفتاح — جرب التالي
          state.errors++;
          break;
        }
        // خطأ حقيقي غير قابل للإعادة
        state.errors++;
        throw e;
      }
    }
  }

  throw new Error("TTS: فشلت جميع المفاتيح.");
}

// ─── تحويل PCM خام إلى WAV (Gemini يُعيد PCM 24kHz 16-bit mono) ───────────
function pcmToWav(pcmBuffer, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
  const dataLen    = pcmBuffer.length;
  const headerSize = 44;
  const wav        = Buffer.alloc(headerSize + dataLen);
  // RIFF header
  wav.write("RIFF",                0);
  wav.writeUInt32LE(36 + dataLen,  4);
  wav.write("WAVE",                8);
  // fmt  chunk
  wav.write("fmt ",               12);
  wav.writeUInt32LE(16,           16);  // chunk size
  wav.writeUInt16LE(1,            20);  // PCM
  wav.writeUInt16LE(channels,     22);
  wav.writeUInt32LE(sampleRate,   24);
  wav.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, 28);
  wav.writeUInt16LE(channels * bitsPerSample / 8, 32);
  wav.writeUInt16LE(bitsPerSample,34);
  // data chunk
  wav.write("data",               36);
  wav.writeUInt32LE(dataLen,      40);
  pcmBuffer.copy(wav, headerSize);
  return wav;
}

// ─── الأمر الرئيسي ────────────────────────────────────────────────────────
export default {
  config: {
    name:        "tts2",
    aliases:     ["قل"],
    version:     "1.0.0",
    role:        0,
    countDown:   8,
    category:    "ذكاء اصطناعي",
    description: "تحويل نص إلى صوت عبر Gemini TTS المباشر — مع تدوير مفاتيح وأصوات",
    usage: [
      "{pn}tts2 <نص> — صوت عشوائي من Gemini",
      "{pn}tts2 <اسم الصوت> | <نص> — صوت محدد",
      "{pn}tts2 أصوات — قائمة الأصوات المتاحة",
      "{pn}tts2 حالة — حالة المفاتيح والـ Rate Limit",
    ],
  },

  onStart: async ({ api, event, args, message }) => {
    const { threadID, messageID } = event;

    const manager = getKeyManager();
    if (!manager) {
      return message.reply(
        "❌ لم يتم تكوين مفاتيح Gemini.\n" +
        "أضف في متغيرات البيئة:\n" +
        "TTS=AIzaSyXXXX,AIzaSyYYYY,AIzaSyZZZZ"
      );
    }

    const raw = (args || []).join(" ").trim();

    // ── بدون نص — إرشادات ─────────────────────────────────────
    if (!raw) {
      return message.reply(
        `🎙️ Gemini TTS — ${manager.totalKeys} مفاتيح نشطة\n\n` +
        `.tts2 <نص> — صوت عشوائي\n` +
        `.tts2 <اسم الصوت> | <نص> — صوت محدد\n` +
        `.tts2 أصوات — عرض الأصوات (${VOICES.length} صوت)\n` +
        `.tts2 حالة — حالة المفاتيح`
      );
    }

    // ── عرض الأصوات ────────────────────────────────────────────
    if (raw === "أصوات" || raw.toLowerCase() === "voices") {
      const list = VOICES.map((v, i) => `${i + 1}. ${v}`).join("\n");
      return message.reply(`🎙️ الأصوات المتاحة (${VOICES.length}):\n\n${list}`);
    }

    // ── حالة المفاتيح ───────────────────────────────────────────
    if (raw === "حالة" || raw.toLowerCase() === "status") {
      return message.reply(`📊 حالة مفاتيح TTS:\n\n${manager.statusText()}`);
    }

    // ── تحديد الصوت والنص ──────────────────────────────────────
    let voice = "";
    let text  = raw;
    const sep = raw.indexOf("|");
    if (sep !== -1) {
      const candidate = raw.slice(0, sep).trim();
      // تحقق أن الاسم ضمن القائمة (غير case-sensitive)
      const matched = VOICES.find(v => v.toLowerCase() === candidate.toLowerCase());
      if (matched) {
        voice = matched;
        text  = raw.slice(sep + 1).trim();
      }
      // إذا لم يُعرف الصوت → اعتبر الكل نصاً
    }

    // إذا لم يُحدد صوت → دوّر تلقائياً
    if (!voice) voice = manager.nextVoice();
    if (!text)  return message.reply("❌ النص فارغ.");

    // حد النص 4500 حرف (Gemini TTS)
    if (text.length > 4500) {
      text = text.slice(0, 4500);
      await message.reply("⚠️ النص أطول من 4500 حرف — سيتم اقتطاعه.");
    }

    let tmpFile;
    try {
      // جلب الصوت مع تدوير المفاتيح التلقائي
      const pcmBuffer = await fetchTTS(manager, text, voice);

      // تحويل PCM → WAV
      const wavBuffer = pcmToWav(pcmBuffer);

      // حفظ مؤقت وإرسال
      tmpFile = path.join(os.tmpdir(), `tts2_${Date.now()}.wav`);
      await fs.writeFile(tmpFile, wavBuffer);

      await global.safeSend(
        api,
        {
          body:       `🎙️ ${voice}`,
          attachment: fs.createReadStream(tmpFile),
        },
        threadID, null, messageID
      );

    } catch (e) {
      console.error("[TTS2]", e.message);
      const msg = e.message.startsWith("⏳") || e.message.startsWith("❌")
        ? e.message
        : `❌ فشل توليد الصوت:\n${e.message.slice(0, 300)}`;
      await message.reply(msg);
    } finally {
      if (tmpFile) fs.remove(tmpFile).catch(() => {});
    }
  },
};

// ─── Plugin Descriptor ──────────────────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-commands-ai-tts2',
  meta: { category: 'command-ai', path: 'src/commands/ai/tts2.js' },
  setup(_ctx) {},
};
