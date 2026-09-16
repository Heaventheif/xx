/**
 * archive.js — أرشفة أو إلغاء أرشفة محادثة
 * يستخدم api.changeArchivedStatus من fca-unofficial
 */
export default {
  config: {
    name: "archive",
    aliases: ["أرشفة", "أرشف"],
    version: "1.0.0",
    author: "sunken",
    countDown: 5,
    role: 2,
    category: "إدارة وإشراف",
    description: "أرشفة المحادثة الحالية أو إلغاء أرشفتها",
    usage: [
      "{pn}أرشفة — أرشفة المحادثة الحالية",
      "{pn}أرشفة إلغاء — إلغاء الأرشفة",
      "{pn}أرشفة <GID> — أرشفة محادثة بمعرفها",
    ],
  },

  onStart: async ({ api, event, args, message }) => {
    const { threadID } = event;

    if (typeof api.changeArchivedStatus !== "function") {
      return message.reply("❌ هذه الميزة غير متاحة في الإصدار الحالي من FCA.");
    }

    const isUnarchive =
      args[0]?.toLowerCase() === "إلغاء" ||
      args[0]?.toLowerCase() === "unarchive" ||
      args[0]?.toLowerCase() === "false";

    // GID مباشر: .أرشفة 123456
    const targetID =
      args[0] && /^\d{5,20}$/.test(args[0]) ? args[0] :
      args[1] && /^\d{5,20}$/.test(args[1]) ? args[1] :
      threadID;

    try {
      await api.changeArchivedStatus(targetID, !isUnarchive);
      return message.reply(
        isUnarchive
          ? `✅ تم إلغاء أرشفة المحادثة (${targetID}).`
          : `📦 تم أرشفة المحادثة (${targetID}).`
      );
    } catch (err) {
      console.debug("[archive] changeArchivedStatus failed:", err?.message);
      return message.reply("❌ فشل تغيير حالة الأرشفة.");
    }
  },
};

// ─── Plugin Descriptor ───────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: "xx-commands-admin-archive",
  meta: { category: "command-admin", path: "src/commands/admin/archive.js" },
  setup(_ctx) {},
};
