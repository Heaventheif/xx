/**
 * nickname.js — تغيير لقب عضو في المجموعة
 * يستخدم api.changeNickname من fca-unofficial (MQTT، label 44)
 */
export default {
  config: {
    name: "nickname",
    aliases: ["لقب", "nick"],
    version: "1.0.0",
    author: "sunken",
    countDown: 3,
    role: 0,
    category: "إدارة وإشراف",
    description: "تغيير لقب عضو في المجموعة (منشن أو رد + الاسم)",
    usage: [
      "{pn}لقب @شخص <اللقب الجديد> — تغيير لقب عضو",
      "{pn}لقب @شخص — مسح اللقب (إعادته للاسم الأصلي)",
      "رد على رسالة + {pn}لقب <اللقب> — تغيير لقب صاحب الرسالة",
    ],
  },

  onStart: async ({ api, event, args, message, isGroupAdmin }) => {
    const { threadID, mentions, messageReply } = event;

    if (!isGroupAdmin) {
      return message.reply("❌ هذا الأمر لمشرفي المجموعة فقط!");
    }

    if (typeof api.changeNickname !== "function") {
      return message.reply("❌ هذه الميزة غير متاحة في الإصدار الحالي من FCA.");
    }

    let targetID = null, targetName = "العضو";
    const mentionIDs = Object.keys(mentions);

    if (mentionIDs.length > 0) {
      targetID   = mentionIDs[0];
      targetName = mentions[targetID].replace(/@/g, " ").trim();
      // الاسم يأتي بعد المنشن
      const mentionTag = Object.values(mentions)[0];
      const afterMention = args.join(" ").replace(mentionTag, "").trim();
      var newNickname = afterMention || "";
    } else if (messageReply) {
      targetID   = messageReply.senderID;
      targetName = "صاحب الرسالة";
      var newNickname = args.join(" ").trim();
    }

    if (!targetID) {
      return message.reply(
        "❌ حدد العضو بالمنشن أو الرد على رسالته.\n" +
        "مثال: لقب @شخص الملك"
      );
    }

    try {
      await api.changeNickname(newNickname || "", threadID, targetID);
      return newNickname
        ? message.reply(`✅ تم تغيير لقب ${targetName} إلى:\n「${newNickname}」`)
        : message.reply(`✅ تمت إزالة لقب ${targetName}.`);
    } catch (err) {
      const msg = err?.message || String(err);
      console.debug("[nickname] changeNickname failed:", msg);
      if (msg.includes("MQTT") || msg.includes("mqtt")) {
        return message.reply("❌ يجب أن يكون البوت متصلاً عبر MQTT لاستخدام هذا الأمر.");
      }
      return message.reply("❌ فشل تغيير اللقب. تأكد أن البوت مشرف.");
    }
  },
};

// ─── Plugin Descriptor ───────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: "xx-commands-admin-nickname",
  meta: { category: "command-admin", path: "src/commands/admin/nickname.js" },
  setup(_ctx) {},
};
