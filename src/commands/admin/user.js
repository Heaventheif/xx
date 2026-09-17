"use strict";

// ✅ لا حاجة لـ permission.js — الكور يتحقق من config.role تلقائياً قبل run()
// role: 1 = مشرف المجموعة | 2 = مطور البوت فقط

module.exports = {
  config: {
    name: "user",
    version: "2.1.0",
    author: "dev",
    countDown: 5,
    role: 1, // الكور يمنع الوصول تلقائياً إذا role < 1
    description: {
      ar: "إدارة المستخدمين: معرف، اسم، طرد، حظر، إضافة",
    },
    category: "admin",
    guide: {
      ar:
        "{pn} id @شخص          — عرض UID الشخص\n" +
        "{pn} name [رد/منشن/UID] <اسم> — تغيير اللقب\n" +
        "{pn} kick @شخص        — طرد من المجموعة\n" +
        "{pn} ban @شخص         — حظر المستخدم من البوت (مطور فقط)\n" +
        "{pn} add <UID>         — إضافة مستخدم للمجموعة",
    },
  },

  // ─── نقطة الدخول ────────────────────────────────────────────────
  // الكور يمرر: role (0=عضو، 1=مشرف_مجموعة_فعلي، 2=مطور) + isGroupAdmin
  run: async function ({ api, event, args, role, Users, Threads, prefix }) {
    const { threadID, messageID } = event;
    const sub = (args[0] || "").toLowerCase();

    // ── توجيه الأوامر الفرعية ──────────────────────────────────────
    switch (sub) {
      case "id":
        return handleID(api, event, Users);
      case "name":
        return handleName(api, event, args.slice(1));
      case "kick":
        return handleKick(api, event);
      case "ban":
        return handleBan(api, event, Users, role);
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
  const { threadID, messageID, mentions = {}, messageReply, senderID } = event;

  // الأولوية: منشن، ثم صاحب الرسالة المردود عليها، ثم UID مكتوب، ثم المرسل نفسه.
  const mentionedTargets = Object.keys(mentions);
  const replyTarget = messageReply?.senderID || messageReply?.participantID || messageReply?.authorID;
  const explicitTargets = args.filter((a) => /^\d{10,}$/.test(String(a)));
  const targets = mentionedTargets.length
    ? mentionedTargets
    : replyTarget
      ? [String(replyTarget)]
      : explicitTargets.length
        ? [...new Set(explicitTargets.map(String))]
        : senderID
          ? [String(senderID)]
          : [];
  if (!targets.length)
    return api.sendMessage("⚠️ تعذّر تحديد المستهدف. استخدم ردًا أو منشن أو UID.", threadID, messageID);

  // الاسم الجديد: كل النص بعد إزالة الأرقام والمنشن
  const newName = args
    .filter((a) => !a.startsWith("@") && !/^\d{10,}$/.test(String(a)))
    .join(" ")
    .trim();

  if (!newName)
    return api.sendMessage(
      `⚠️ أدخل الاسم الجديد.\nأمثلة: user name @شخص الاسم الجديد أو user name 123456789012 الاسم الجديد أو بالرد على رسالة الشخص`,
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
      const name = (mentions[uid] || "").replace("@", "") || (uid === String(senderID) ? "نفسك" : uid);
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
//  user ban  —  حظر المستخدم من البوت (مطور البوت فقط: role === 2)
// ═══════════════════════════════════════════════════════════════════
async function handleBan(api, event, Users, role) {
  const { threadID, messageID, mentions } = event;

  // يتطلب مطور بوت (role 2) — يُحسب من getUserRole في الكور
  if (role < 2)
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
