"use strict";

/**
 * note — Daily scheduled note/reminder per thread.
 *
 * Commands (require role >= 2 — moderator):
 *   note set <text>   → Set a daily note for this group (sent every midnight)
 *   note off          → Disable the daily note for this group
 *   note now          → Send the note immediately (test)
 *   note list         → List all active notes (admin only, role >= 3)
 *
 * Storage: note-schedules.json  (next to index.js, persists across restarts)
 *
 * Lifecycle:
 *   onSchedule({ api, tick }) is called every midnight by the daily tick in
 *   index.js. It iterates all saved notes and sends them to their threads.
 */

import fs   from "fs";
import path from "path";

// ── Persistent storage ────────────────────────────────────────────────────────
// Map structure: { [threadID]: { text: string, setBy: string, setAt: number } }

const STORE_PATH = path.join(import.meta.dir, "../note-schedules.json");

function loadStore() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    }
  } catch (e) {
    console.warn("[NOTE] ⚠️ Failed to load note-schedules.json:", e.message);
  }
  return {};
}

function saveStore(store) {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
  } catch (e) {
    console.warn("[NOTE] ⚠️ Failed to save note-schedules.json:", e.message);
  }
}

// Load once at startup; mutate in place so onSchedule always sees latest state.
const _notes = loadStore();

// ── Helper: send a note to a thread safely ───────────────────────────────────
function sendNote(api, threadID, text) {
  const msg = `📌 تذكير يومي\n\n${text}\n\n🕛 ${new Date().toLocaleString("ar-DZ", { timeZone: "Africa/Algiers" })}`;
  api.sendMessage(msg, threadID, (err) => {
    if (err) console.warn(`[NOTE] ⚠️ فشل إرسال النوتة إلى ${threadID}:`, err?.message || err);
  });
}

// ── Command export ────────────────────────────────────────────────────────────
export default {
  config: {
    name:        "note",
    aliases:     ["نوتة", "تذكير"],
    version:     "1.0.0",
    role:        2,                // moderator minimum to set/remove
    countDown:   5,
    category:    "إدارة وإشراف",
    description: "ضبط تذكير يومي يُرسَل تلقائياً منتصف الليل في هذه المجموعة",
    usage: [
      "{pn}note set <النص>   — ضبط نوتة يومية",
      "{pn}note off          — إيقاف النوتة اليومية",
      "{pn}note now          — إرسال النوتة الآن (اختبار)",
      "{pn}note list         — قائمة كل النوتات النشطة (أدمن فقط)",
    ],
  },

  // ── Main command handler ──────────────────────────────────────────────────
  run: async ({ api, event, args, role }) => {
    const { threadID, senderID } = event;
    const sub  = (args[0] || "").toLowerCase();
    const text = args.slice(1).join(" ").trim();

    // --- note set <text> ---
    if (sub === "set" || sub === "ضبط") {
      if (!text) {
        return api.sendMessage("❌ اكتب النص بعد الأمر:\n.note set مرحباً بكم 😊", threadID);
      }
      _notes[threadID] = { text, setBy: senderID, setAt: Date.now() };
      saveStore(_notes);
      return api.sendMessage(
        `✅ تم ضبط النوتة اليومية!\n\n📝 "${text}"\n\nستُرسَل كل يوم عند منتصف الليل 🕛`,
        threadID
      );
    }

    // --- note off ---
    if (sub === "off" || sub === "إيقاف") {
      if (!_notes[threadID]) {
        return api.sendMessage("ℹ️ لا توجد نوتة نشطة في هذه المجموعة.", threadID);
      }
      delete _notes[threadID];
      saveStore(_notes);
      return api.sendMessage("🔕 تم إيقاف النوتة اليومية لهذه المجموعة.", threadID);
    }

    // --- note now (test send) ---
    if (sub === "now" || sub === "الآن") {
      if (!_notes[threadID]) {
        return api.sendMessage("ℹ️ لا توجد نوتة مضبوطة — استخدم .note set <النص> أولاً.", threadID);
      }
      sendNote(api, threadID, _notes[threadID].text);
      return;
    }

    // --- note list (admin only) ---
    if (sub === "list" || sub === "قائمة") {
      if (role < 3) {
        return api.sendMessage("❌ هذا الأمر مخصص للأدمن فقط.", threadID);
      }
      const entries = Object.entries(_notes);
      if (!entries.length) {
        return api.sendMessage("📋 لا توجد نوتات نشطة حالياً.", threadID);
      }
      const lines = entries.map(([tid, { text }], i) =>
        `${i + 1}. [${tid}]\n   "${text.slice(0, 60)}${text.length > 60 ? "…" : ""}"`
      );
      return api.sendMessage(
        `📋 النوتات اليومية النشطة (${entries.length}):\n\n${lines.join("\n\n")}`,
        threadID
      );
    }

    // --- Usage help ---
    return api.sendMessage(
      `📌 أمر النوتة اليومية:\n\n` +
      `.note set <النص>   — ضبط نوتة يومية\n` +
      `.note off          — إيقاف النوتة\n` +
      `.note now          — إرسال فوري (اختبار)\n` +
      `.note list         — قائمة الكل (أدمن)`,
      threadID
    );
  },

  // ── Daily tick hook — called every midnight by index.js ──────────────────
  onSchedule: ({ api, tick }) => {
    const entries = Object.entries(_notes);
    if (!entries.length) return;

    console.log(`[NOTE] 🕛 ${tick.firedAt} — إرسال ${entries.length} نوتة يومية...`);
    for (const [threadID, { text }] of entries) {
      sendNote(api, threadID, text);
    }
  },
};
