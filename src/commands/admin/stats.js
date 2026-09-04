"use strict";
/**
 * stats — Group and personal statistics command.
 * Shows message count, active users, commands used, uptime, and DB health.
 *
 * M-02 fix: added lastActive timestamp + hourly cleanup to prevent Map growth.
 */

const THREAD_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours before thread entry is pruned

const _threadStats = new Map();
const _globalStats = {
  totalMessages: 0,
  totalCommands: 0,
  startedAt: Date.now(),
};

// M-02 fix: hourly cleanup of stale thread entries
setInterval(() => {
  const now = Date.now();
  for (const [tid, data] of _threadStats) {
    if (now - data.lastActive > THREAD_TTL_MS) {
      _threadStats.delete(tid);
    }
  }
}, 60 * 60 * 1000);

export function recordMessage(threadID, senderID, commandName) {
  _globalStats.totalMessages++;
  if (commandName) _globalStats.totalCommands++;
  let t = _threadStats.get(String(threadID));
  if (!t) {
    t = { msgCount: 0, users: new Map(), commands: new Map(), lastActive: Date.now() };
    _threadStats.set(String(threadID), t);
  }
  // M-02 fix: keep lastActive updated so stale entries get cleaned up
  t.lastActive = Date.now();
  t.msgCount++;
  t.users.set(String(senderID), (t.users.get(String(senderID)) || 0) + 1);
  if (commandName) {
    t.commands.set(commandName, (t.commands.get(commandName) || 0) + 1);
  }
}

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}ي ${h}س ${m}د`;
  if (h > 0) return `${h}س ${m}د`;
  return `${m}د ${s % 60}ث`;
}

export default {
  config: {
    name: "stats",
    aliases: ["إحصائيات"],
    version: "1.1.0",
    role: 4,
    countDown: 10,
    category: "إدارة وإشراف",
    description: "إحصاءات المجموعة والبوت (رسائل، مستخدمون نشطون، أوامر مستخدَمة)",
    usage: [
      "{pn}stats — إحصاءات هذه المجموعة",
      "{pn}stats global — إحصاءات البوت الكلية",
    ],
  },
  onChat: async ({ event }) => {
    const { threadID, senderID, body } = event;
    if (!body?.trim()) return;
    const firstWord = body.trim().split(/\s+/)[0].toLowerCase();
    const cmd = global.commands?.get(firstWord) ? firstWord : null;
    recordMessage(threadID, senderID, cmd);
  },
  onStart: async ({ api, event, args, message }) => {
    const { threadID } = event;
    const isGlobal = args[0]?.toLowerCase() === "global";
    if (isGlobal) {
      const uptimeMs = Date.now() - _globalStats.startedAt;
      const lines = [
        "📊 إحصاءات البوت الكلية",
        "─".repeat(30),
        `🕐 وقت التشغيل: ${formatUptime(uptimeMs)}`,
        `💬 رسائل مُعالَجة: ${_globalStats.totalMessages.toLocaleString("ar")}`,
        `⚡ أوامر مُنفَّذة: ${_globalStats.totalCommands.toLocaleString("ar")}`,
        `📂 أوامر محمَّلة: ${global.commands?.size || 0}`,
        `🗄️ قاعدة البيانات: ${global.db ? "✅ متصلة" : "⚠️ غير متصلة"}`,
        `👥 مجموعات نشطة: ${_threadStats.size}`,
        `🧠 مستخدمون في الذاكرة: ${global.usersData?.size || 0}`,
      ];
      return message.reply(lines.join("\n"));
    }
    const t = _threadStats.get(String(threadID));
    if (!t || t.msgCount === 0) {
      return message.reply("📊 لا توجد إحصاءات لهذه المجموعة بعد — سيبدأ التسجيل من الآن.");
    }
    const topUsers = [...t.users.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    const topCmds = [...t.commands.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    const lines = [
      "📊 إحصاءات هذه المجموعة",
      "─".repeat(30),
      `💬 رسائل: ${t.msgCount.toLocaleString("ar")}`,
      `👥 مستخدمون نشطون: ${t.users.size}`,
      "",
      "🏆 أكثر المستخدمين نشاطاً:",
      ...topUsers.map(([uid, cnt], i) => `  ${i + 1}. ${uid} — ${cnt} رسالة`),
    ];
    if (topCmds.length > 0) {
      lines.push("", "⚡ أكثر الأوامر استخداماً:");
      topCmds.forEach(([cmd, cnt], i) => lines.push(`  ${i + 1}. ${cmd} × ${cnt}`));
    }
    return message.reply(lines.join("\n"));
  },
};
