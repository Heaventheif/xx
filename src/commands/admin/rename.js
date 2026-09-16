/**
 * rename.js — تغيير اسم المجموعة
 * يستخدم api.setTitle من fca-unofficial (MQTT أولاً، ثم HTTP fallback)
 */
export default {
  config: {
    name: "rename",
    aliases: ["اسم", "سمي"],
    version: "1.0.0",
    author: "sunken",
    countDown: 5,
    role: 0,
    category: "إدارة وإشراف",
    description: "تغيير اسم المجموعة",
    usage: ["{pn}اسم <الاسم الجديد> — تغيير اسم المجموعة"],
  },

  onStart: async ({ api, event, args, message, isGroupAdmin }) => {
    const { threadID } = event;

    if (!isGroupAdmin) {
      return message.reply("❌ هذا الأمر لمشرفي المجموعة فقط!");
    }

    const newName = args.join(" ").trim();
    if (!newName) {
      return message.reply("❌ أدخل الاسم الجديد للمجموعة.\nمثال: اسم مجموعتي الجديدة");
    }
    if (newName.length > 200) {
      return message.reply("❌ الاسم طويل جداً (الحد 200 حرف).");
    }

    try {
      await api.setTitle(newName, threadID);
      return message.reply(`✅ تم تغيير اسم المجموعة إلى:\n「${newName}」`);
    } catch (err) {
      const msg = err?.message || String(err);
      console.debug("[rename] setTitle failed:", msg);
      if (msg.includes("single-user") || msg.includes("1545003")) {
        return message.reply("❌ لا يمكن تغيير اسم محادثة فردية.");
      }
      if (msg.includes("1545012") || msg.includes("Not member")) {
        return message.reply("❌ البوت غير عضو في هذه المجموعة.");
      }
      return message.reply("❌ فشل تغيير الاسم. تأكد أن البوت مشرف.");
    }
  },
};

// ─── Plugin Descriptor ───────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: "xx-commands-admin-rename",
  meta: { category: "command-admin", path: "src/commands/admin/rename.js" },
  setup(_ctx) {},
};
