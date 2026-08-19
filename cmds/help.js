// ─── help — دليل الأوامر المنسق لفيسبوك (سلسلة رسائل مرتبة بالفئات) ────
// يُبنى ديناميكيًا من global.commands وقت كل استدعاء — لا يوجد نص أوامر
// ثابت بالكود، فأي أمر يُضاف/يُحذف/يُعدّل بمجلد cmds/ ينعكس تلقائيًا هنا
// بدون الحاجة لتحديث help.js يدويًا.

const BOT_NAME = "𝗦𝘂𝗻𝗸𝗲𝗻𝗕𝗼𝘁";
const PAGE_MAX_LEN = 7000; // حد أحرف كل صفحة (رسالة فيسبوك واحدة)

// ─── قراءة الأوامر الحية من registry البوت (global.commands) ────────────
// global.commands عبارة عن Map يسجّل بها loadCommands كل اسم وكل بديل
// يشير لنفس كائن الأمر — فنستخرج القيم الفريدة بالاعتماد على config.name.
function getLiveCommands() {
  const map = global.commands;
  if (!(map instanceof Map) || map.size === 0) return [];

  const seen = new Map(); // name -> cmd (لإزالة التكرار الناتج عن الأسماء المستعارة)
  for (const cmd of map.values()) {
    const cfg = cmd?.config;
    if (!cfg?.name) continue;
    if (cfg.hidden || cfg.enabled === false) continue;
    if (!seen.has(cfg.name)) seen.set(cfg.name, cmd);
  }
  return [...seen.values()];
}

// ─── تحويل كل أمر لصف موحد يستخدمه العرض والبحث ─────────────────────────
function toEntry(cmd) {
  const cfg = cmd.config || {};
  return {
    name: String(cfg.name || ""),
    aliases: Array.isArray(cfg.aliases) ? cfg.aliases.map(String) : [],
    desc: String(cfg.description || "بدون وصف"),
    cat: String(cfg.category || "أخرى"),
  };
}

// ─── بناء صفحات الدليل ديناميكيًا مقسّمة على فئات ثم على طول الرسالة ────
function buildPages(entries) {
  // تجميع حسب الفئة، مع الحفاظ على ترتيب أول ظهور للفئة
  const byCat = new Map();
  for (const e of entries) {
    if (!byCat.has(e.cat)) byCat.set(e.cat, []);
    byCat.get(e.cat).push(e);
  }

  const header =
    `═══════════════════════\n✦ ${BOT_NAME} ✦ دليل الأوامر الكامل\n═══════════════════════\n` +
    `📌 عدد الأوامر المتاحة: ${entries.length} أمرًا | اكتب اسم الأمر أو أحد بدائله لإطلاقه\n` +
    `───────────────────────\n`;
  const footer =
    `───────────────────────\n💡 تلميح: يمكنك البحث في الأوامر — اكتب الاسم أو البديل أو جزءًا من الوصف\n` +
    `مثال: «مساعدة يوتيوب» / «cmds دردشة»\n═══════════════════════\n⌁ ${BOT_NAME} — بوت المانجا والروايات والذكاء الاصطناعي`;

  let block = "";
  for (const [cat, cmds] of byCat) {
    block += `📂 ── ${cat} ── 📂\n`;
    for (const c of cmds) {
      const aliasTxt = c.aliases.length ? `${c.name} │ ${c.aliases.join("، ")}` : c.name;
      block += `▸ ${aliasTxt}\n`;
    }
  }

  // تقسيم block إلى صفحات ≤ PAGE_MAX_LEN (يراعي حد رسائل فيسبوك)
  const pages = [];
  const lines = block.split("\n");
  let cur = header;
  for (const line of lines) {
    const chunk = line + "\n";
    if (cur.length + chunk.length + footer.length > PAGE_MAX_LEN && cur !== header) {
      pages.push(cur.trim());
      cur = "";
    }
    cur += chunk;
  }
  cur += footer;
  pages.push(cur.trim());
  return pages;
}

// ─── البحث المدمج ─────────────────────────────────────────────────────
function searchEntries(entries, q) {
  return entries.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.aliases.some((a) => a.toLowerCase().includes(q)) ||
      c.desc.toLowerCase().includes(q),
  );
}

// safeSend: يرسل رسالة (رد أولي أو سلسلة) في فيسبوك، الأخطاء في اللوغ فقط
const _ss = typeof globalThis.safeSend === "function" ? globalThis.safeSend : null;
const S = _ss
  ? _ss
  : async (a, t, tid, mid) => {
      try {
        return await a.sendMessage(t, tid, mid);
      } catch (e) {
        console.error("[help] " + e.message);
        return null;
      }
    };

export default {
  config: {
    name: "help",
    aliases: ["اوامر", "مساعدة"],
    version: "3.0.0",
    author: "Sunken",
    countDown: 3,
    role: 0,
    category: "أدوات عامة",
    description: "دليل الأوامر الكامل مرتبًا بالفئات مع وصف لكل أمر وبدائله + بحث مدمج (مبني ديناميكيًا من الأوامر المسجّلة فعليًا)",
    usage: [
      "{pn}مساعدة — عرض دليل الأوامر كاملًا",
      "{pn}مساعدة — كلمة — البحث في الأوامر (بالاسم أو البديل أو جزء من الوصف)",
    ],
  },
  onStart: async ({ api, event, args }) => {
    const entries = getLiveCommands().map(toEntry);

    if (!entries.length) {
      await S(api, "⚠️ تعذّر جلب قائمة الأوامر حاليًا — حاول لاحقًا.", event.threadID, event.messageID);
      return;
    }

    const q = (args || []).join(" ").trim().toLowerCase();
    if (q) {
      const results = searchEntries(entries, q);
      if (results.length === 0) {
        await S(api, "لم يعثر على أوامر تطابق «" + q + "» — جرّب كلمة أخرى", event.threadID, event.messageID);
        return;
      }
      const txt =
        "═══ نتائج البحث (" + results.length + ") ═══\n" +
        results.map((c, i) => "▸ " + (i + 1) + ". " + c.name + "\n   " + c.desc).join("\n");
      await S(api, txt, event.threadID, event.messageID);
      return;
    }

    const pages = buildPages(entries);
    let lastId = event.messageID || null;
    for (const page of pages) {
      const res = await S(api, page, event.threadID, lastId);
      lastId = res?.messageID || null;
    }
  },
};
