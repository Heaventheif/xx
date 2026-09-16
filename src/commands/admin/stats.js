"use strict";
/**
 * stats.js — إحصاءات المجموعة / البوت + معلومات المجموعة
 * دمج: stats + threadinfo
 *
 * الأوامر الفرعية:
 *   stats             — إحصاءات هذه المجموعة
 *   stats global      — إحصاءات البوت الكلية
 *   stats info        — معلومات المجموعة التفصيلية (threadinfo سابقاً)
 */

// ─── متتبع الإحصاءات ─────────────────────────────────────────────
const THREAD_TTL_MS = 24 * 60 * 60 * 1000;

const _threadStats = new Map();
const _globalStats = {
  totalMessages: 0,
  totalCommands: 0,
  startedAt: Date.now(),
};

if (!global.__statsCleanupStarted) {
  global.__statsCleanupStarted = true;
  setInterval(() => {
    const now = Date.now();
    for (const [tid, data] of _threadStats) {
      if (now - data.lastActive > THREAD_TTL_MS) _threadStats.delete(tid);
    }
  }, 60 * 60 * 1000);
}

export function recordMessage(threadID, senderID, commandName) {
  _globalStats.totalMessages++;
  if (commandName) _globalStats.totalCommands++;
  let t = _threadStats.get(String(threadID));
  if (!t) {
    t = { msgCount: 0, users: new Map(), commands: new Map(), lastActive: Date.now() };
    _threadStats.set(String(threadID), t);
  }
  t.lastActive = Date.now();
  t.msgCount++;
  t.users.set(String(senderID), (t.users.get(String(senderID)) || 0) + 1);
  if (commandName) t.commands.set(commandName, (t.commands.get(commandName) || 0) + 1);
}

// ─── مساعدات ─────────────────────────────────────────────────────
function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}ي ${h}س ${m}د`;
  if (h > 0) return `${h}س ${m}د`;
  return `${m}د ${s % 60}ث`;
}

function formatMuteUntil(ts) {
  if (!ts) return 'لا';
  try { return new Date(ts).toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' }); }
  catch { return String(ts); }
}

// ─── الأمر ───────────────────────────────────────────────────────
export default {
  config: {
    name: 'stats',
    aliases: ['إحص', 'info'],
    version: '2.0.0',
    role: 2,
    countDown: 10,
    category: 'إدارة وإشراف',
    description: 'إحصاءات المجموعة / البوت + معلومات المجموعة التفصيلية',
    usage: [
      '{pn}stats — إحصاءات هذه المجموعة',
      '{pn}stats global — إحصاءات البوت الكلية',
      '{pn}stats info — معلومات المجموعة التفصيلية',
    ],
  },

  // تسجيل كل رسالة
  onChat: async ({ event }) => {
    const { threadID, senderID, body } = event;
    if (!body?.trim()) return;
    const firstWord = body.trim().split(/\s+/)[0].toLowerCase();
    const cmd = global.commands?.get(firstWord) ? firstWord : null;
    recordMessage(threadID, senderID, cmd);
  },

  onStart: async ({ api, event, args, message }) => {
    const { threadID } = event;
    const sub = (args[0] || '').trim().toLowerCase();

    // ── معلومات المجموعة (threadinfo) ────────────────────────────
    if (sub === 'info' || sub === 'معلومات') {
      try {
        const info = await api.getThreadInfo(threadID);
        if (!info) return message.reply('❌ فشل جلب معلومات المجموعة.');

        const name     = info.threadName || info.name || '[بدون اسم]';
        const members  = info.participantIDs?.length ?? '?';
        const adminIDs = (info.adminIDs || [])
          .map((a) => String(typeof a === 'object' ? a.id : a));
        const admins   = adminIDs.length
          ? adminIDs.join(', ')
          : '—';
        const isGroup  = info.isGroup ?? info.threadType === 'GROUP';
        const emoji    = info.emoji || '👍';
        const color    = info.color || '#0084ff';
        const msgCount = info.messageCount ?? '—';
        const archived = info.isArchived ? 'نعم' : 'لا';
        const muted    = formatMuteUntil(info.muteUntil);

        return message.reply([
          `📋 معلومات ${isGroup ? 'المجموعة' : 'المحادثة'}`,
          '─'.repeat(28),
          `📛 الاسم: ${name}`,
          `🆔 GID: ${threadID}`,
          `👥 الأعضاء: ${members}`,
          `🎖️ المشرفون: ${admins}`,
          `${emoji} الإيموجي: ${emoji}`,
          `🎨 اللون: ${color}`,
          `💬 إجمالي الرسائل: ${msgCount}`,
          `📦 مؤرشفة: ${archived}`,
          `🔕 مكتومة: ${muted}`,
        ].join('\n'));
      } catch (err) {
        console.debug('[stats info] getThreadInfo failed:', err?.message);
        return message.reply('❌ فشل جلب معلومات المجموعة.');
      }
    }

    // ── إحصاءات كلية ─────────────────────────────────────────────
    if (sub === 'global' || sub === 'كلي') {
      const uptimeMs = Date.now() - _globalStats.startedAt;
      return message.reply([
        '📊 إحصاءات البوت الكلية',
        '─'.repeat(30),
        `🕐 وقت التشغيل: ${formatUptime(uptimeMs)}`,
        `💬 رسائل مُعالَجة: ${_globalStats.totalMessages.toLocaleString('ar')}`,
        `⚡ أوامر مُنفَّذة: ${_globalStats.totalCommands.toLocaleString('ar')}`,
        `📂 أوامر محمَّلة: ${global.commands?.size || 0}`,
        `🗄️ قاعدة البيانات: ${global.db ? '✅ متصلة' : '⚠️ غير متصلة'}`,
        `👥 مجموعات نشطة: ${_threadStats.size}`,
        `🧠 مستخدمون في الذاكرة: ${global.usersData?.size || 0}`,
      ].join('\n'));
    }

    // ── إحصاءات المجموعة (افتراضي) ───────────────────────────────
    const t = _threadStats.get(String(threadID));
    if (!t || t.msgCount === 0) {
      return message.reply('📊 لا توجد إحصاءات لهذه المجموعة بعد — سيبدأ التسجيل من الآن.');
    }

    const topUsers = [...t.users.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const topCmds  = [...t.commands.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

    const lines = [
      '📊 إحصاءات هذه المجموعة',
      '─'.repeat(30),
      `💬 رسائل: ${t.msgCount.toLocaleString('ar')}`,
      `👥 مستخدمون نشطون: ${t.users.size}`,
      '',
      '🏆 أكثر المستخدمين نشاطاً:',
      ...topUsers.map(([uid, cnt], i) => `  ${i + 1}. ${uid} — ${cnt} رسالة`),
    ];
    if (topCmds.length) {
      lines.push('', '⚡ أكثر الأوامر استخداماً:');
      topCmds.forEach(([cmd, cnt], i) => lines.push(`  ${i + 1}. ${cmd} × ${cnt}`));
    }
    lines.push('', '💡 stats info — لمعلومات المجموعة التفصيلية');

    return message.reply(lines.join('\n'));
  },
};

// ─── Plugin Descriptor ───────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-commands-admin-stats',
  meta: { category: 'command-admin', path: 'src/commands/admin/stats.js' },
  setup(_ctx) {
    // provides: recordMessage
  },
};
