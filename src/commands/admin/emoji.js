/**
 * emoji.js — تغيير إيموجي المجموعة
 * يستخدم api.setThreadEmoji من fca-unofficial
 */
export default {
  config: {
    name: "emoji",
    aliases: ["ايموجي", "رمز"],
    version: "1.0.0",
    author: "sunken",
    countDown: 3,
    role: 0,
    category: "إدارة وإشراف",
    description: "تغيير الإيموجي الافتراضي للمجموعة",
    usage: [
      "{pn}ايموجي ❤️ — تغيير إيموجي المجموعة",
      "{pn}ايموجي — إعادة الإيموجي للافتراضي (👍)",
    ],
  },

  onStart: async ({ api, event, args, message, isGroupAdmin }) => {
    const { threadID } = event;

    if (!isGroupAdmin) {
      return message.reply("❌ هذا الأمر لمشرفي المجموعة فقط!");
    }

    if (typeof api.setThreadEmoji !== "function") {
      return message.reply("❌ هذه الميزة غير متاحة في الإصدار الحالي من FCA.");
    }

    // الإيموجي الافتراضي لفيسبوك هو 👍
    const newEmoji = args[0] || "👍";

    try {
      await api.setThreadEmoji(newEmoji, threadID);
      return message.reply(`✅ تم تغيير إيموجي المجموعة إلى ${newEmoji}`);
    } catch (err) {
      console.debug("[emoji] setThreadEmoji failed:", err?.message);
      return message.reply("❌ فشل تغيير الإيموجي. تأكد أن البوت مشرف.");
    }
  },
};

// ─── Plugin Descriptor ───────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: "xx-commands-admin-emoji",
  meta: { category: "command-admin", path: "src/commands/admin/emoji.js" },
  setup(_ctx) {},
};
