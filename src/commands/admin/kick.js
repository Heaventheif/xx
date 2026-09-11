export default {
  config: {
    name: "kick",
    aliases: ["طرد"],
    version: "1.3.0",
    author: "sunken",
    countDown: 5,
    role: 0,
    category: "إدارة وإشراف",
    description: "طرد عضو من المجموعة (منشن أو ID أو رد على رسالته)",
    usage: [
      "{pn}طرد @شخص — طرد عضو محدد بالمنشن",
      "{pn}طرد 100012345678 — طرد عضو بالـ ID مباشرة",
      "رد على رسالة + {pn}طرد — طرد صاحب الرسالة المردود عليها",
    ],
  },
  onStart: async ({ api, event, args, message, isGroupAdmin }) => {
    const { threadID, senderID, mentions, messageReply } = event;

    // isGroupAdmin comes pre-resolved from Router.js — single source of truth
    if (!isGroupAdmin) {
      return message.reply("❌ هذا الأمر لمشرفي المجموعة فقط!");
    }

    const botID = String(api.getCurrentUserID());

    // Resolve target: mention > raw numeric ID > reply
    let targetID = null, targetName = "المستخدم";
    const mentionIDs = Object.keys(mentions);

    if (mentionIDs.length > 0) {
      targetID   = mentionIDs[0];
      targetName = mentions[targetID].replace(/@/g, " ").trim();
    } else if (args.length > 0 && /^\d{5,20}$/.test(args[0].trim())) {
      // Raw numeric FB ID passed directly (e.g. "طرد 61559165694344")
      targetID   = args[0].trim();
      targetName = `(ID: ${targetID})`;
    } else if (messageReply) {
      targetID   = messageReply.senderID;
      targetName = "صاحب الرسالة";
    }

    if (!targetID) {
      return message.reply("❌ الرجاء تحديد المستخدم المراد طرده (منشن، ID، أو رد).");
    }
    if (String(targetID) === botID) {
      return message.reply("🤣 لا يمكنني طرد نفسي!");
    }
    if (String(targetID) === String(senderID)) {
      return message.reply("🤔 لا يمكنك طرد نفسك!");
    }

    try {
      await api.removeUserFromGroup(targetID, threadID);
      await message.reply(`♻️ ${targetName} إلى القمامة! 👋`);
    } catch (error) {
      const msg = error?.message || "";
      // FCA throws a specific error when target is an admin
      if (msg.includes("admin") || msg.includes("1545012") || msg.includes("not authorized")) {
        return message.reply("⚠️ لا يمكن طرد مشرف آخر!");
      }
      console.debug("[kick] removeUserFromGroup failed:", msg);
      return message.reply("❌ فشل في طرد المستخدم. تأكد أن البوت مشرف.");
    }
  }
};

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-commands-admin-kick',
  meta: { category: 'command-admin', path: 'src/commands/admin/kick.js' },
  setup(_ctx) {
    // see module exports
  },
};
