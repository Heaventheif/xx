/**
 * unfriend.js — حذف صديق من قائمة الأصدقاء
 * يستخدم api.unfriend من fca-unofficial
 */
export default {
  config: {
    name: "unfriend",
    aliases: ["حذف_صديق", "إلغاء_صداقة"],
    version: "1.0.0",
    author: "sunken",
    countDown: 10,
    role: 2,
    category: "إدارة وإشراف",
    description: "حذف مستخدم من قائمة أصدقاء البوت",
    usage: [
      "{pn}حذف_صديق @شخص — حذف بالمنشن",
      "{pn}حذف_صديق <UID> — حذف بالـ ID",
      "رد على رسالة + {pn}حذف_صديق — حذف صاحب الرسالة",
    ],
  },

  onStart: async ({ api, event, args, message, mentions, messageReply }) => {
    const { senderID } = event;

    if (typeof api.unfriend !== "function") {
      return message.reply("❌ هذه الميزة غير متاحة في الإصدار الحالي من FCA.");
    }

    let targetID = null, targetName = "المستخدم";
    const mentionIDs = Object.keys(event.mentions || {});

    if (mentionIDs.length > 0) {
      targetID   = mentionIDs[0];
      targetName = (event.mentions[targetID] || "").replace(/@/g, " ").trim();
    } else if (args[0] && /^\d{5,20}$/.test(args[0].trim())) {
      targetID   = args[0].trim();
      targetName = `(ID: ${targetID})`;
    } else if (event.messageReply) {
      targetID   = event.messageReply.senderID;
      targetName = "صاحب الرسالة";
    }

    if (!targetID) {
      return message.reply("❌ حدد المستخدم بالمنشن أو الـ ID أو الرد.");
    }

    try {
      await api.unfriend(targetID);
      return message.reply(`✅ تم حذف ${targetName} من قائمة الأصدقاء.`);
    } catch (err) {
      console.debug("[unfriend] failed:", err?.message);
      return message.reply(`❌ فشل حذف ${targetName}.\nقد لا يكون في قائمة أصدقاء البوت.`);
    }
  },
};

// ─── Plugin Descriptor ───────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: "xx-commands-admin-unfriend",
  meta: { category: "command-admin", path: "src/commands/admin/unfriend.js" },
  setup(_ctx) {},
};
