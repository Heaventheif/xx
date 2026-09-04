export default {
  config: {
    name: "kick",
    aliases: ["طرد"],
    version: "1.1.0",
    author: "sunken",
    countDown: 5,
    role: 1,
    category: "إدارة وإشراف",
    description: "طرد عضو من المجموعة (منشن أو رد على رسالته)",
    usage: [
      "{pn}طرد @شخص — طرد عضو محدد بالمنشن",
      "رد على رسالة + {pn}طرد — طرد صاحب الرسالة المردود عليها",
    ],
  },
  onStart: async ({ api, event, message }) => {
    const { threadID, messageID, senderID, mentions, messageReply } = event;

    // M-05 fix: wrap getThreadInfo in try-catch (can fail or return stale data)
    let threadInfo;
    try {
      threadInfo = await api.getThreadInfo(threadID);
    } catch {
      return message.reply("❌ فشل في جلب معلومات المجموعة — حاول مرة أخرى.");
    }

    const adminIDs = threadInfo.adminIDs || [];

    // M-05 fix: check that the bot itself is an admin before attempting kick
    const botID = api.getCurrentUserID();
    const isBotAdmin = adminIDs.some(a => String(a.id) === String(botID));
    if (!isBotAdmin) {
      return message.reply("❌ البوت ليس مشرفاً في هذه المجموعة — لا يمكنه الطرد.");
    }

    // Check that the sender is an admin
    const isSenderAdmin = adminIDs.some(a => String(a.id) === String(senderID));
    if (!isSenderAdmin) {
      return message.reply("❌ هذا الأمر للمشرفين فقط!");
    }

    let targetID = null, targetName = "المستخدم";
    const mentionIDs = Object.keys(mentions);
    if (mentionIDs.length > 0) {
      targetID = mentionIDs[0];
      targetName = mentions[targetID].replace(/@/g, " ").trim();
    } else if (messageReply) {
      targetID = messageReply.senderID;
      targetName = "صاحب الرسالة";
    }

    if (!targetID) return message.reply("❌ الرجاء تحديد المستخدم المراد طرده (منشن أو رد).");
    if (String(targetID) === String(botID)) return message.reply("🤣 لا يمكنني طرد نفسي!");
    if (adminIDs.some(a => String(a.id) === String(targetID))) {
      return message.reply("⚠️ لا يمكن طرد مشرف آخر!");
    }

    try {
      await api.removeUserFromGroup(targetID, threadID);
      await message.reply(`♻️ ${targetName} إلى القمامة! 👋`);
    } catch (error) {
      console.debug("[kick] removeUserFromGroup failed:", error?.message);
      return message.reply("❌ فشل في طرد المستخدم. تأكد أن البوت مشرف.");
    }
  }
};
