/**
 * leave.js — مغادرة البوت للمجموعة
 * يستخدم api.removeUserFromGroup لإزالة البوت من المجموعة
 * (فيسبوك لا يدعم "leave" مباشرة في Messenger API)
 */
export default {
  config: {
    name: "leave",
    aliases: ["مغادرة", "خروج"],
    version: "1.0.0",
    author: "sunken",
    countDown: 10,
    role: 2,
    category: "إدارة وإشراف",
    description: "إخراج البوت من المجموعة الحالية (للمطورين فقط)",
    hidden: true,
    usage: [
      "{pn}مغادرة — إخراج البوت من هذه المجموعة",
      "{pn}مغادرة <GID> — إخراج البوت من مجموعة بمعرّفها",
    ],
  },

  onStart: async ({ api, event, args, message }) => {
    const { threadID, senderID } = event;

    const targetGID = (args[0] && /^\d{5,20}$/.test(args[0]))
      ? args[0]
      : threadID;

    const botID = String(api.getCurrentUserID());

    try {
      await message.reply(
        `⚠️ سيغادر البوت المجموعة (${targetGID})...\nوداعاً! 👋`
      );
      // إزالة البوت من المجموعة — بعض الإصدارات تحتاج مشرف آخر لإخراجه
      await api.removeUserFromGroup(botID, targetGID);
    } catch (err) {
      const msg = err?.message || String(err);
      console.debug("[leave] removeUserFromGroup failed:", msg);
      if (msg.includes("admin") || msg.includes("not authorized")) {
        return message.reply(
          "❌ لا يمكن إخراج البوت لأنه مشرف.\n" +
          "قم أولاً بإزالة صلاحية الإشراف عنه، ثم أعد المحاولة."
        );
      }
      return message.reply(`❌ فشل إخراج البوت: ${msg}`);
    }
  },
};

// ─── Plugin Descriptor ───────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: "xx-commands-admin-leave",
  meta: { category: "command-admin", path: "src/commands/admin/leave.js" },
  setup(_ctx) {},
};
