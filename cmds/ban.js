"use strict";

import fs from "fs-extra";
import path from "path";
import { buildBanSets } from "../utils/banList";

const CONFIG_PATH = path.join(import.meta.dir, "..", "config.json");

async function saveConfig() {
  await fs.writeFile(CONFIG_PATH, JSON.stringify(global.config, null, 2), "utf8");
  buildBanSets(); // apply immediately, no restart needed
}

export default {
  config: {
    name: "ban",
    aliases: ["حظر"],
    version: "1.0.0",
    role: 4, // admins/developers only — this controls whether the bot works at all somewhere
    countDown: 3,
    category: "إدارة وإشراف",
    description: "إدارة قائمة الحظر — المجموعات/المستخدمين الذين لا يجب أن يعمل البوت لهم إطلاقاً",
    usage: [
      "{pn}حظر مجموعة <GID> — منع البوت من العمل في هذه المجموعة نهائياً",
      "{pn}حظر مستخدم <UID> — منع البوت من الاستجابة لهذا المستخدم في أي مكان",
      "{pn}حظر الغاء مجموعة <GID> — رفع الحظر عن مجموعة",
      "{pn}حظر الغاء مستخدم <UID> — رفع الحظر عن مستخدم",
      "{pn}حظر قائمة — عرض كل المجموعات/المستخدمين المحظورين",
      "{pn}حظر مجموعة — بدون GID: يحظر المجموعة الحالية",
    ],
  },

  // Command entry point: add/remove/list banned group or user IDs.
  onStart: async ({ event, args, message }) => {
    const { threadID } = event;
    const sub = args[0]?.toLowerCase();

    if (!global.config.bannedGroups) global.config.bannedGroups = [];
    if (!global.config.bannedUsers) global.config.bannedUsers = [];

    if (sub === "قائمة" || sub === "list") {
      const groups = global.config.bannedGroups;
      const users = global.config.bannedUsers;
      return message.reply(
        `🚫 المجموعات المحظورة (${groups.length}):\n${groups.join("\n") || "—"}\n\n` +
        `🚫 المستخدمون المحظورون (${users.length}):\n${users.join("\n") || "—"}`
      );
    }

    const isUnban = sub === "الغاء" || sub === "إلغاء" || sub === "unban";
    const kindArg = (isUnban ? args[1] : sub)?.toLowerCase();
    const idArg = (isUnban ? args[2] : args[1]) || null;

    const isGroup = kindArg === "مجموعة" || kindArg === "group" || kindArg === "gid";
    const isUser = kindArg === "مستخدم" || kindArg === "user" || kindArg === "uid";
    if (!isGroup && !isUser) {
      return message.reply(
        "❌ الاستخدام:\n" +
        "حظر مجموعة <GID>\n" +
        "حظر مستخدم <UID>\n" +
        "حظر الغاء مجموعة <GID>\n" +
        "حظر الغاء مستخدم <UID>\n" +
        "حظر قائمة"
      );
    }

    const targetID = String(idArg || (isGroup ? threadID : "")).trim();
    if (!targetID) return message.reply("❌ حدد المعرّف (GID أو UID).");

    const listKey = isGroup ? "bannedGroups" : "bannedUsers";
    const list = global.config[listKey];

    if (isUnban) {
      const idx = list.indexOf(targetID);
      if (idx === -1) return message.reply(`ℹ️ ${targetID} غير موجود في قائمة الحظر أصلاً.`);
      list.splice(idx, 1);
      await saveConfig();
      return message.reply(`✅ تم رفع الحظر عن ${isGroup ? "المجموعة" : "المستخدم"}: ${targetID}`);
    }

    if (list.includes(targetID)) return message.reply(`ℹ️ ${targetID} محظور بالفعل.`);
    list.push(targetID);
    await saveConfig();
    return message.reply(
      `🚫 تم حظر ${isGroup ? "المجموعة" : "المستخدم"}: ${targetID}\n` +
      "لن يستجيب البوت هناك بعد الآن إطلاقاً."
    );
  },
};
