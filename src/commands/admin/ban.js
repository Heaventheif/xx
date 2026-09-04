"use strict";
import { isValidFbId } from "../../utils/validate.js";
import { addBanDB, removeBanDB } from "../../db/index.js";
export default {
  config: {
    name: "ban",
    aliases: ["حظر"],
    version: "2.0.0",
    role: 4, 
    countDown: 3,
    category: "إدارة وإشراف",
    description: "إدارة قائمة الحظر الدائمة (MongoDB) — المجموعات/المستخدمين الذين لا يجب أن يعمل البوت لهم إطلاقاً",
    usage: [
      "{pn}حظر مجموعة <GID> — منع البوت من العمل في هذه المجموعة نهائياً",
      "{pn}حظر مستخدم <UID> — منع البوت من الاستجابة لهذا المستخدم في أي مكان",
      "{pn}حظر الغاء مجموعة <GID> — رفع الحظر عن مجموعة",
      "{pn}حظر الغاء مستخدم <UID> — رفع الحظر عن مستخدم",
      "{pn}حظر قائمة — عرض كل المجموعات/المستخدمين المحظورين",
      "{pn}حظر مجموعة — بدون GID: يحظر المجموعة الحالية",
    ],
  },
  onStart: async ({ event, args, message }) => {
    const { threadID, senderID } = event;
    const sub = args[0]?.toLowerCase();
    if (sub === "قائمة" || sub === "list") {
      const groups = [...global._bannedGroups];
      const users  = [...global._bannedUsers];
      return message.reply(
        `🚫 المجموعات المحظورة (${groups.length}):\n${groups.join("\n") || "—"}\n\n` +
        `🚫 المستخدمون المحظورون (${users.length}):\n${users.join("\n") || "—"}\n\n` +
        (global.db
          ? "💾 القائمة محفوظة في MongoDB — دائمة عبر إعادة التشغيل."
          : "⚠️ لا يوجد اتصال حالي بقاعدة البيانات — القائمة المعروضة من الذاكرة فقط.")
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
    if (!isValidFbId(targetID)) {
      return message.reply(`❌ "${targetID}" ليس معرّف فيسبوك صالحاً (يجب أن يكون رقماً من 5-20 خانة).`);
    }
    const type = isGroup ? "group" : "user";
    const set  = isGroup ? global._bannedGroups : global._bannedUsers;
    const label = isGroup ? "المجموعة" : "المستخدم";
    if (isUnban) {
      if (!set.has(targetID)) return message.reply(`ℹ️ ${targetID} غير موجود في قائمة الحظر أصلاً.`);
      if (!global.db) {
        return message.reply(
          "⚠️ لا يوجد اتصال حالي بقاعدة البيانات — لا يمكن رفع الحظر بشكل دائم الآن.\n" +
          "حاول لاحقاً بعد استعادة الاتصال بـ MongoDB."
        );
      }
      const ok = await removeBanDB(type, targetID);
      if (!ok) return message.reply("❌ فشل رفع الحظر من قاعدة البيانات — حاول لاحقاً.");
      set.delete(targetID);
      return message.reply(`✅ تم رفع الحظر عن ${label}: ${targetID}`);
    }
    if (set.has(targetID)) return message.reply(`ℹ️ ${targetID} محظور بالفعل.`);
    if (!global.db) {
      return message.reply(
        "⚠️ لا يوجد اتصال حالي بقاعدة البيانات — لا يمكن حفظ الحظر بشكل دائم الآن.\n" +
        "حاول لاحقاً بعد استعادة الاتصال بـ MongoDB."
      );
    }
    const ok = await addBanDB(type, targetID, senderID);
    if (!ok) return message.reply("❌ فشل حفظ الحظر في قاعدة البيانات — حاول لاحقاً.");
    set.add(targetID);
    return message.reply(
      `🚫 تم حظر ${label}: ${targetID}\n` +
      "لن يستجيب البوت هناك بعد الآن إطلاقاً.\n" +
      "🔒 هذا حظر دائم محفوظ في MongoDB — لا يُرفع إلا بأمر (حظر الغاء) من مطوّر، أو بحذف المدخلة يدوياً من قاعدة البيانات."
    );
  },
};
