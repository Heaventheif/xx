// aki.js — Akinator via raw WS API (bypasses bot-detection 403)
// لا يعتمد على akinator-client بل يتصل بـ API الخام مباشرة

const ANSWERS_AR = [
  "0 — نعم ✅",
  "1 — لا ❌",
  "2 — لا أعرف 🤷",
  "3 — على الأرجح نعم 🟢",
  "4 — على الأرجح لا 🔴",
];

const MAX_STEPS = 70;
const STATE_ASKING  = "asking";
const STATE_GUESSING = "guessing";

global.akinatorSessions = global.akinatorSessions ?? new Map();

// ── Raw WS helpers ─────────────────────────────────────────────────────────

const SERVERS  = ["srv2","srv3","srv4","srv6","srv9","srv11","srv14"];
const LANG_MAP = { ar: "ar", en: "en", fr: "fr" };

const AKI_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Referer"   : "https://en.akinator.com/",
  "Accept"    : "*/*",
  "Accept-Language": "en-US,en;q=0.9",
};

function parseJSONP(text) {
  return JSON.parse(text.replace(/^[^(]+\(/, "").replace(/\);?\s*$/, ""));
}

async function akiFetch(url) {
  const res = await fetch(url, { headers: AKI_HEADERS, signal: AbortSignal.timeout(10_000) });
  const text = await res.text();
  if (!text || res.status >= 400) throw new Error(`HTTP ${res.status}`);
  return parseJSONP(text);
}

async function startSession(lang = "ar") {
  const l = LANG_MAP[lang] ?? "en";
  const errors = [];
  for (const srv of SERVERS) {
    try {
      const ts  = Date.now();
      const url = `https://${srv}.api.${l}.akinator.com/ws/new_session?` +
        new URLSearchParams({
          callback: "jQuery",
          partner: "1",
          player: "website-desktop",
          uid_ext_session: "",
          frontaddr: "",
          constraint: "ETAT<>'AV'",
          childMod: "false",
          _: ts,
        });
      const data = await akiFetch(url);
      if (data.completion !== "OK") throw new Error(data.completion);
      const id   = data.parameters.identification;
      const step = data.parameters.step_information;
      return {
        server: srv, lang: l,
        session: id.session, signature: id.signature,
        question: step.question,
        progression: parseFloat(step.progression ?? 0),
        step: 0,
      };
    } catch (e) {
      errors.push(`${srv}: ${e.message}`);
    }
  }
  throw new Error("كل سيرفرات أكيناتور فشلت:\n" + errors.join("\n"));
}

async function answerStep(sess, answer) {
  const url = `https://${sess.server}.api.${sess.lang}.akinator.com/ws/answer?` +
    new URLSearchParams({
      callback: "jQuery",
      session: sess.session,
      signature: sess.signature,
      step: sess.step,
      answer,
      frontaddr: "",
      _: Date.now(),
    });
  const data = await akiFetch(url);
  if (data.completion !== "OK") throw new Error(data.completion);
  const info = data.parameters;
  return info;
}

async function backStep(sess) {
  const url = `https://${sess.server}.api.${sess.lang}.akinator.com/ws/cancel_answer?` +
    new URLSearchParams({
      callback: "jQuery",
      session: sess.session,
      signature: sess.signature,
      step: sess.step,
      answer: "-1",
      frontaddr: "",
      _: Date.now(),
    });
  const data = await akiFetch(url);
  if (data.completion !== "OK") throw new Error(data.completion);
  return data.parameters;
}

async function getGuess(sess) {
  const url = `https://${sess.server}.api.${sess.lang}.akinator.com/ws/list?` +
    new URLSearchParams({
      callback: "jQuery",
      session: sess.session,
      signature: sess.signature,
      step: sess.step,
      size: 1,
      max_pic_width: 246,
      max_pic_height: 294,
      pref_photos: "VO-OK",
      duel_allowed: 1,
      _: Date.now(),
    });
  const data = await akiFetch(url);
  if (data.completion !== "OK") throw new Error(data.completion);
  return data.parameters?.elements?.[0]?.element ?? null;
}

// ── UI helpers ──────────────────────────────────────────────────────────────

function progressBar(pct, len = 12) {
  const n = Math.round(pct / 100 * len);
  return "█".repeat(n) + "░".repeat(len - n);
}

function buildQuestion(sess) {
  const pct = Math.round(sess.progression);
  return [
    `🔮 أكيناتور — السؤال ${sess.step + 1}`,
    `📊 ${progressBar(pct)} ${pct}%`,
    "",
    `❓ ${sess.question}`,
    "",
    "💡 الإجابات (رد برقم):",
    ...ANSWERS_AR,
    "",
    '↩️  رد بـ "ر" للرجوع للسؤال السابق',
  ].join("\n");
}

function buildGuess(guess) {
  return [
    "🎯 أعتقد أنك تفكر في:",
    "",
    `👤 الاسم: ${guess.name ?? "؟"}`,
    guess.description ? `📝 ${guess.description}` : null,
    guess.absolute_picture_path ? `🖼️ ${guess.absolute_picture_path}` : null,
    "",
    "هل أنا محق؟",
    '  ✅ رد بـ "ص" (صح) — إذا خمّنت صح',
    '  ❌ رد بـ "خ" (خطأ) — لأكمل الأسئلة',
  ].filter(Boolean).join("\n");
}

function buildWin(guess) {
  return [
    "🥳 رائع! كنت أعلم أنك تفكر في:",
    "",
    `👤 ${guess?.name ?? "؟"}`,
    guess?.description ? `📝 ${guess.description}` : null,
    "",
    "🎮 اكتب (اكيناتور) للعب مجدداً!",
  ].filter(Boolean).join("\n");
}

function buildKO() {
  return [
    "🏳️ لقد استسلمت! لم أتمكن من تخمين شخصيتك هذه المرة.",
    "",
    "🎮 اكتب (اكيناتور) للعب مجدداً!",
  ].join("\n");
}

function registerReply(sentMsg, senderID, commandName = "اكيناتور") {
  sentMsg?.messageID &&
    (global.Kagenou.replies[sentMsg.messageID] = { commandName, author: senderID });
}

function sendAndRegister(api, text, threadID, replyTo, senderID) {
  return new Promise((resolve) => {
    api.sendMessage(text, threadID, (err, msg) => {
      if (!err) registerReply(msg, senderID);
      resolve(msg);
    }, replyTo);
  });
}

// ── Export ──────────────────────────────────────────────────────────────────

export default {
  config: {
    name: "aki",
    aliases: ["مارد", "اكيناتور"],
    role: 0,
    countDown: 3,
    category: "ألعاب وترفيه",
    description: "العب مع المارد ليخمن الشخصية التي تفكر بها",
    usage: [
      "{pn}مارد — ابدأ لعبة جديدة",
      "أجب بأرقام 0-4 على كل سؤال",
      "رد بـ 'ر' للرجوع للسؤال السابق",
    ],
  },

  onStart: async ({ api, event }) => {
    const { threadID, messageID, senderID } = event;
    global.akinatorSessions.delete(senderID);

    try {
      const sess = await startSession("ar");
      global.akinatorSessions.set(senderID, { sess, state: STATE_ASKING, guess: null });
      await sendAndRegister(api, buildQuestion(sess), threadID, messageID, senderID);
    } catch (e) {
      console.error("[اكيناتور onStart]", e.message);
      api.sendMessage(
        "❌ فشل الاتصال بسيرفرات أكيناتور.\n" + e.message.substring(0, 200),
        threadID, null, messageID
      );
    }
  },

  onReply: async ({ api, event, Reply }) => {
    const { threadID, messageID, senderID, body } = event;
    if (senderID !== Reply.author) return;

    const record = global.akinatorSessions.get(senderID);
    if (!record) {
      return api.sendMessage(
        "⚠️ لا توجد لعبة نشطة. اكتب (اكيناتور) لبدء لعبة جديدة.",
        threadID, null, messageID
      );
    }

    const { sess, state } = record;
    const input = body.trim().toLowerCase();

    // ── حالة التخمين (انتظار تأكيد اللاعب) ──
    if (state === STATE_GUESSING) {
      const guess = record.guess;
      if (input === "ص" || input === "نعم" || input === "yes") {
        global.akinatorSessions.delete(senderID);
        return api.sendMessage(buildWin(guess), threadID, null, messageID);
      }
      if (input === "خ" || input === "لا" || input === "no") {
        // تابع الأسئلة
        try {
          const info = await answerStep(sess, 0); // أجب بنعم داخلياً للمتابعة
          sess.step++;
          sess.question    = info.question;
          sess.progression = parseFloat(info.progression ?? sess.progression);
          record.state = STATE_ASKING;
          record.guess = null;
          return await sendAndRegister(api, buildQuestion(sess), threadID, messageID, senderID);
        } catch (e) {
          global.akinatorSessions.delete(senderID);
          return api.sendMessage(`❌ خطأ: ${e.message}\nاكتب (اكيناتور) لبدء من جديد.`, threadID, null, messageID);
        }
      }
      // أعد إرسال سؤال التأكيد
      return await sendAndRegister(api, buildGuess(guess), threadID, messageID, senderID);
    }

    // ── رجوع ──
    if (input === "ر" || input === "رجوع" || input === "back") {
      if (sess.step <= 0) {
        return api.sendMessage("⚠️ أنت في السؤال الأول، لا يمكن الرجوع!", threadID, null, messageID);
      }
      try {
        const info = await backStep(sess);
        sess.step = Math.max(0, sess.step - 1);
        sess.question    = info.question;
        sess.progression = parseFloat(info.progression ?? sess.progression);
        return await sendAndRegister(api, buildQuestion(sess), threadID, messageID, senderID);
      } catch (e) {
        return api.sendMessage(`❌ فشل الرجوع: ${e.message}`, threadID, null, messageID);
      }
    }

    // ── إجابة رقمية ──
    const ans = parseInt(input);
    if (isNaN(ans) || ans < 0 || ans > 4) {
      return api.sendMessage(
        `❌ إجابة غير صالحة! أجب برقم 0–4 أو 'ر' للرجوع.\n\n` + buildQuestion(sess),
        threadID,
        (err, msg) => { if (!err) registerReply(msg, senderID); },
        messageID
      );
    }

    try {
      const info = await answerStep(sess, ans);
      sess.step++;
      sess.question    = info.question;
      sess.progression = parseFloat(info.progression ?? sess.progression);

      // فحص KO
      if (info.progression == null && !info.question) {
        global.akinatorSessions.delete(senderID);
        return api.sendMessage(buildKO(), threadID, null, messageID);
      }

      // فحص ما إذا يجب التخمين
      const shouldGuess = parseFloat(info.progression ?? 0) >= 85 || sess.step >= MAX_STEPS;
      if (shouldGuess) {
        const guess = await getGuess(sess);
        if (!guess) {
          global.akinatorSessions.delete(senderID);
          return api.sendMessage(buildKO(), threadID, null, messageID);
        }
        record.state = STATE_GUESSING;
        record.guess = guess;
        return await sendAndRegister(api, buildGuess(guess), threadID, messageID, senderID);
      }

      return await sendAndRegister(api, buildQuestion(sess), threadID, messageID, senderID);
    } catch (e) {
      console.error(`[اكيناتور onReply خطوة ${sess.step}]`, e.message);
      global.akinatorSessions.delete(senderID);
      api.sendMessage(
        `❌ خطأ في الخطوة ${sess.step}: ${e.message}\nاكتب (اكيناتور) لبدء جلسة جديدة.`,
        threadID, null, messageID
      );
    }
  },
};
