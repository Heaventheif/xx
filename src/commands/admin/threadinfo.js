/**
 * threadinfo.js — عرض معلومات المجموعة الكاملة
 * يستخدم api.getThreadInfo من fca-unofficial
 */
export default {
  config: {
    name: "threadinfo",
    aliases: ["معلومات_المجموعة", "groupinfo"],
    version: "1.0.0",
    author: "sunken",
    countDown: 10,
    role: 0,
    category: "إدارة وإشراف",
    description: "عرض معلومات تفصيلية عن المجموعة الحالية",
    usage: ["{pn}معلومات_المجموعة — عرض معلومات المجموعة"],
  },

  onStart: async ({ api, event, message }) => {
    const { threadID } = event;

    try {
      const info = await api.getThreadInfo(threadID);

      if (!info) return message.reply("❌ فشل جلب معلومات المجموعة.");

      const name       = info.threadName || info.name || "[بدون اسم]";
      const members    = info.participantIDs?.length ?? "?";
      const admins     = (info.adminIDs || [])
        .map((a) => (typeof a === "object" ? a.id : a))
        .join(", ") || "—";
      const isGroup    = info.isGroup ?? info.threadType === "GROUP";
      const emoji      = info.emoji || "👍";
      const color      = info.color || "#0084ff";
      const msgCount   = info.messageCount ?? "—";
      const archived   = info.isArchived ? "نعم" : "لا";
      const muted      = info.muteUntil ? `حتى ${new Date(info.muteUntil).toLocaleString("ar")}` : "لا";

      const lines = [
        `📋 معلومات ${isGroup ? "المجموعة" : "المحادثة"}`,
        "─".repeat(28),
        `📛 الاسم: ${name}`,
        `🆔 GID: ${threadID}`,
        `👥 الأعضاء: ${members}`,
        `🎖️ المشرفون: ${admins}`,
        `${emoji} الإيموجي: ${emoji}`,
        `🎨 اللون: ${color}`,
        `💬 إجمالي الرسائل: ${msgCount}`,
        `📦 مؤرشفة: ${archived}`,
        `🔕 مكتومة: ${muted}`,
      ];

      return message.reply(lines.join("\n"));
    } catch (err) {
      console.debug("[threadinfo] getThreadInfo failed:", err?.message);
      return message.reply("❌ فشل جلب معلومات المجموعة.");
    }
  },
};

// ─── Plugin Descriptor ───────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: "xx-commands-admin-threadinfo",
  meta: { category: "command-admin", path: "src/commands/admin/threadinfo.js" },
  setup(_ctx) {},
};
