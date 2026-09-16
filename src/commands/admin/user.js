"use strict";

const { checkPermission } = require("../../utils/permission");

module.exports = {
  config: {
    name: "user",
    version: "2.0.0",
    author: "dev",
    countDown: 5,
    role: 1, // 1 = مشرف المجموعة | 2 = مطور البوت فقط
    description: {
      ar: "إدارة المستخدمين: معرف، اسم، طرد، حظر، إضافة",
    },
    category: "admin",
    guide: {
      ar:
        "{pn} id @شخص          — عرض UID الشخص\n" +
        "{pn} name @شخص <اسم>  — تغيير اللقب\n" +
        "{pn} kick @شخص        — طرد من المجموعة\n" +
        "{pn} ban @شخص         — حظر المستخدم من البوت\n" +
        "{pn} add <UID>         — إضافة مستخدم للمجموعة",
    },
  },

  // ─── نقطة الدخول ────────────────────────────────────────────────
  run: async function ({ api, event, args, Users, Threads, prefix }) {
    const { threadID, senderID, messageID } = event;
    const sub = (args[0] || "").toLowerCase();

    // ── فحص الصلاحية ──────────────────────────────────────────────
    const allowed = await checkPermission(api, event, ["groupAdmin", "botDev"]);
    if (!allowed)
      return api.sendMessage(
        "⛔ هذا الأمر متاح للمشرفين ومطوري البوت فقط.",
        threadID,
        messageID
      );

    // ── توجيه الأوامر الفرعية ──────────────────────────────────────
    switch (sub) {
      case "id":
        return handleID(api, event, Users);
      case "name":
        return handleName(api, event, args.slice(1));
      case "kick":
        return handleKick(api, event);
      case "ban":
        return handleBan(api, event, Users, senderID);
      case "add":
        return handleAdd(api, event, args.slice(1));
      default:
        return api.sendMessage(
          `❓ الاستخدام:\n${module.exports.config.guide.ar.replace(/{pn}/g, prefix + "user")}`,
          threadID,
          messageID
        );
    }
  },
};

// ═══════════════════════════════════════════════════════════════════
//  user id  —  عرض UID
// ═══════════════════════════════════════════════════════════════════
async function handleID(api, event, Users) {
  const { threadID, messageID, mentions, senderID } = event;

  const targets = Object.keys(mentions || {});

  // بدون منشن → عرض UID المرسِل
  if (!targets.length) {
    return api.sendMessage(
      `🆔 معرّفك (UID): ${senderID}`,
      threadID,
      messageID
    );
  }

  const lines = targets.map((uid) => {
    const name = (mentions[uid] || "").replace("@", "") || uid;
    return `👤 ${name}\n🆔 UID: ${uid}`;
  });

  api.sendMessage(lines.join("\n\n"), threadID, messageID);
}

// ═══════════════════════════════════════════════════════════════════
//  user name  —  تغيير اللقب (nickname)
// ═══════════════════════════════════════════════════════════════════
async function handleName(api, event, args) {
  const { threadID, messageID, mentions } = event;

  const targets = Object.keys(mentions || {});
  if (!targets.length)
    return api.sendMessage("⚠️ قم بمنشن الشخص المراد تغيير لقبه.", threadID, messageID);

  // الاسم الجديد: كل النص بعد إزالة الأرقام والمنشن
  const newName = args
    .filter((a) => !a.startsWith("@") && !/^\d+$/.test(a))
    .join(" ")
    .trim();

  if (!newName)
    return api.sendMessage(
      "⚠️ أدخل الاسم الجديد بعد المنشن.\nمثال: user name @شخص الاسم الجديد",
      threadID,
      messageID
    );

  const results = [];
  for (const uid of targets) {
    try {
      await new Promise((res, rej) =>
        api.changeNickname(newName, threadID, uid, (err) =>
          err ? rej(err) : res()
        )
      );
      const name = (mentions[uid] || "").replace("@", "") || uid;
      results.push(`✅ تم تغيير لقب ${name} إلى "${newName}"`);
    } catch {
      results.push(`❌ فشل تغيير لقب ${uid}`);
    }
  }

  api.sendMessage(results.join("\n"), threadID, messageID);
}

// ═══════════════════════════════════════════════════════════════════
//  user kick  —  طرد من المجموعة
// ═══════════════════════════════════════════════════════════════════
async function handleKick(api, event) {
  const { threadID, messageID, mentions, senderID } = event;

  const targets = Object.keys(mentions || {});
  if (!targets.length)
    return api.sendMessage("⚠️ قم بمنشن الشخص المراد طرده.", threadID, messageID);

  // منع طرد النفس
  if (targets.includes(senderID))
    return api.sendMessage("⚠️ لا يمكنك طرد نفسك.", threadID, messageID);

  const results = [];
  for (const uid of targets) {
    try {
      await new Promise((res, rej) =>
        api.removeUserFromGroup(uid, threadID, (err) =>
          err ? rej(err) : res()
        )
      );
      const name = (mentions[uid] || "").replace("@", "") || uid;
      results.push(`✅ تم طرد ${name}`);
    } catch {
      results.push(`❌ فشل طرد ${uid} — تحقق من صلاحيات البوت`);
    }
  }

  api.sendMessage(results.join("\n"), threadID, messageID);
}

// ═══════════════════════════════════════════════════════════════════
//  user ban  —  حظر المستخدم من البوت
// ═══════════════════════════════════════════════════════════════════
async function handleBan(api, event, Users, senderID) {
  const { threadID, messageID, mentions } = event;

  // حظر المستخدم يتطلب مطور بوت
  if (!global.GoatBot?.config?.adminBot?.includes(senderID))
    return api.sendMessage(
      "⛔ حظر المستخدمين متاح لمطوري البوت فقط.",
      threadID,
      messageID
    );

  const targets = Object.keys(mentions || {});
  if (!targets.length)
    return api.sendMessage("⚠️ قم بمنشن الشخص المراد حظره.", threadID, messageID);

  const results = [];
  for (const uid of targets) {
    try {
      const data = await Users.getData(uid);
      if (data?.banned) {
        results.push(`⚠️ ${uid} محظور بالفعل.`);
        continue;
      }
      await Users.setData(uid, { banned: true });
      const name = (mentions[uid] || "").replace("@", "") || uid;
      results.push(`🚫 تم حظر ${name} (${uid})`);
    } catch {
      results.push(`❌ فشل حظر ${uid}`);
    }
  }

  api.sendMessage(results.join("\n"), threadID, messageID);
}

// ═══════════════════════════════════════════════════════════════════
//  user add  —  إضافة مستخدم للمجموعة
// ═══════════════════════════════════════════════════════════════════
async function handleAdd(api, event, args) {
  const { threadID, messageID, mentions } = event;

  // قبول المنشن أو UID مكتوب مباشرة
  let targets = Object.keys(mentions || {});
  if (!targets.length) {
    targets = args.filter((a) => /^\d{10,}$/.test(a));
  }

  if (!targets.length)
    return api.sendMessage(
      "⚠️ قم بمنشن الشخص أو أدخل UID الشخص المراد إضافته.\nمثال: user add 100012345678",
      threadID,
      messageID
    );

  const results = [];
  for (const uid of targets) {
    try {
      await new Promise((res, rej) =>
        api.addUserToGroup(uid, threadID, (err) =>
          err ? rej(err) : res()
        )
      );
      const name = mentions?.[uid]
        ? (mentions[uid] || "").replace("@", "")
        : uid;
      results.push(`✅ تمت إضافة ${name}`);
    } catch (err) {
      const reason =
        err?.error === 1545145 ? "الشخص موجود بالفعل" :
        err?.error === 200     ? "لا توجد صلاحية كافية" :
        "خطأ غير معروف";
      results.push(`❌ فشل إضافة ${uid}: ${reason}`);
    }
  }

  api.sendMessage(results.join("\n"), threadID, messageID);
}
