/**
 * admin.js — ترقية/تخفيض مشرف في المجموعة
 * يستخدم api.changeAdminStatus من fca-unofficial
 */
export default {
  config: {
    name: "admin",
    aliases: ["مشرف", "ترقية"],
    version: "1.0.0",
    author: "sunken",
    countDown: 5,
    role: 0,           // يُسمح للمشرف فقط (يُتحقق داخلياً)
    category: "إدارة وإشراف",
    description: "ترقية عضو لمشرف أو تخفيضه (منشن أو ID أو رد)",
    usage: [
      "{pn}مشرف @شخص — ترقية عضو لمشرف",
      "{pn}مشرف <UID> — ترقية بالـ ID مباشرة",
      "{pn}مشرف إزالة @شخص — إزالة صلاحية الإشراف",
      "رد على رسالة + {pn}مشرف — ترقية صاحب الرسالة",
    ],
  },

  onStart: async ({ api, event, args, message, isGroupAdmin }) => {
    const { threadID, senderID, mentions, messageReply } = event;

    if (!isGroupAdmin) {
      return message.reply("❌ هذا الأمر لمشرفي المجموعة فقط!");
    }

    // هل نريد إزالة الإشراف؟
    const isRevoke =
      args[0]?.toLowerCase() === "إزالة" ||
      args[0]?.toLowerCase() === "تخفيض" ||
      args[0]?.toLowerCase() === "remove";

    const effectiveArgs = isRevoke ? args.slice(1) : args;

    // تحديد الهدف: منشن → ID مباشر → رد
    let targetID = null, targetName = "العضو";
    const mentionIDs = Object.keys(mentions);

    if (mentionIDs.length > 0) {
      targetID   = mentionIDs[0];
      targetName = mentions[targetID].replace(/@/g, " ").trim();
    } else if (effectiveArgs[0] && /^\d{5,20}$/.test(effectiveArgs[0].trim())) {
      targetID   = effectiveArgs[0].trim();
      targetName = `(ID: ${targetID})`;
    } else if (messageReply) {
      targetID   = messageReply.senderID;
      targetName = "صاحب الرسالة";
    }

    if (!targetID) {
      return message.reply(
        "❌ حدد العضو بالمنشن أو الـ ID أو الرد على رسالته.\n" +
        "مثال: مشرف @شخص"
      );
    }

    const botID = String(api.getCurrentUserID());
    if (String(targetID) === botID) {
      return message.reply("🤖 أنا مشرف بالفعل (أو غير مشرف — ولا أقدر أغيّر وضعي).");
    }

    const action = isRevoke ? "إزالة إشراف" : "ترقية";

    try {
      await api.changeAdminStatus(threadID, targetID, !isRevoke);
      return message.reply(
        isRevoke
          ? `✅ تم إزالة صلاحية الإشراف عن ${targetName}.`
          : `✅ تمت ترقية ${targetName} إلى مشرف! 🎖️`
      );
    } catch (err) {
      const msg = err?.message || String(err);
      console.debug(`[admin] changeAdminStatus failed:`, msg);
      if (msg.includes("MQTT") || msg.includes("mqtt")) {
        return message.reply("❌ يجب أن يكون البوت متصلاً عبر MQTT لاستخدام هذا الأمر.");
      }
      return message.reply(`❌ فشل ${action} ${targetName}.\nتأكد أن البوت مشرف في المجموعة.`);
    }
  },
};

// ─── Plugin Descriptor ───────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: "xx-commands-admin-admin",
  meta: { category: "command-admin", path: "src/commands/admin/admin.js" },
  setup(_ctx) {},
};
