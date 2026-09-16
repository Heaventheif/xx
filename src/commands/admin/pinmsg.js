/**
 * pinmsg.js — تثبيت أو إلغاء تثبيت رسالة في المجموعة
 * يستخدم api.pinMessage من fca-unofficial
 *
 * الاستخدام:
 *   رد على رسالة + .تثبيت    ← تثبيت الرسالة
 *   رد على رسالة + .فك_تثبيت ← إلغاء التثبيت
 */
export default {
  config: {
    name: "pinmsg",
    aliases: ["تثبيت", "pin_message"],
    version: "1.0.0",
    author: "sunken",
    countDown: 3,
    role: 0,
    category: "إدارة وإشراف",
    description: "تثبيت رسالة في المجموعة عن طريق الرد عليها",
    usage: [
      "رد على رسالة + {pn}تثبيت — تثبيت الرسالة",
      "رد على رسالة + {pn}تثبيت إلغاء — إلغاء التثبيت",
    ],
  },

  onStart: async ({ api, event, args, message, isGroupAdmin }) => {
    const { threadID, messageReply } = event;

    if (!isGroupAdmin) {
      return message.reply("❌ هذا الأمر لمشرفي المجموعة فقط!");
    }

    if (typeof api.pinMessage !== "function") {
      return message.reply("❌ هذه الميزة غير متاحة في الإصدار الحالي من FCA.");
    }

    if (!messageReply) {
      return message.reply("❌ يجب الرد على الرسالة التي تريد تثبيتها.");
    }

    const isUnpin =
      args[0]?.toLowerCase() === "إلغاء" ||
      args[0]?.toLowerCase() === "unpin" ||
      args[0]?.toLowerCase() === "فك";

    const targetMsgID = messageReply.messageID;

    try {
      // api.pinMessage(messageID, threadID, [unpin=false])
      await api.pinMessage(targetMsgID, threadID, isUnpin);
      return message.reply(
        isUnpin
          ? "✅ تم إلغاء تثبيت الرسالة."
          : "📌 تم تثبيت الرسالة بنجاح!"
      );
    } catch (err) {
      console.debug("[pinmsg] pinMessage failed:", err?.message);
      return message.reply("❌ فشل تثبيت الرسالة. تأكد أن البوت مشرف.");
    }
  },
};

// ─── Plugin Descriptor ───────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: "xx-commands-admin-pinmsg",
  meta: { category: "command-admin", path: "src/commands/admin/pinmsg.js" },
  setup(_ctx) {},
};
