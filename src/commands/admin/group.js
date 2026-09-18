"use strict";

// ✅ لا حاجة لـ permission.js — الكور يتحقق من config.role تلقائياً قبل run()
// role: 1 = مشرف المجموعة | 2 = مطور البوت فقط

module.exports = {
  config: {
    name: "group",
    version: "2.1.0",
    author: "dev",
    countDown: 5,
    role: 1, // الكور يمنع الوصول تلقائياً إذا role < 1
    description: {
      ar: "إدارة المجموعة: معلومات، إحصائيات، حظر، تغيير الاسم، إدارة المشرفين",
    },
    category: "admin",
    guide: {
      ar:
        "{pn} info               — معلومات المجموعة (GID + الأعضاء)\n" +
        "{pn} stats              — إحصائيات المجموعة\n" +
        "{pn} ban                — حظر المجموعة من البوت (مطور فقط)\n" +
        "{pn} rename <الاسم>     — تغيير اسم المجموعة\n" +
        "{pn} admin add @شخص    — إضافة مشرف\n" +
        "{pn} admin remove @شخص — إزالة مشرف",
    },
  },

  // ─── نقطة الدخول ────────────────────────────────────────────────
  // الكور يمرر: role (0=عضو، 1=مشرف_مجموعة_فعلي، 2=مطور) + isGroupAdmin
  run: async function ({ api, event, args, role, Threads, Users, prefix }) {
    const { threadID, senderID, messageID } = event;
    const sub = (args[0] || "").toLowerCase();

    // ── توجيه الأوامر الفرعية ──────────────────────────────────────
    switch (sub) {
      case "info":
        return handleInfo(api, event, Threads, Users);
      case "stats":
        return handleStats(api, event, Threads);
      case "ban":
        return handleBan(api, event, Threads, role);
      case "rename":
        return handleRename(api, event, args.slice(1).join(" "));
      case "admin":
        return handleAdmin(api, event, args.slice(1));
      default:
        return api.sendMessage(
          `❓ الاستخدام:\n${module.exports.config.guide.ar.replace(/{pn}/g, prefix + "group")}`,
          threadID,
          messageID
        );
    }
  },
};

// ═══════════════════════════════════════════════════════════════════
//  group info  —  GID + قائمة الأعضاء
// ═══════════════════════════════════════════════════════════════════
async function handleInfo(api, event, Threads, Users) {
  const { threadID, messageID } = event;

  let info;
  try {
    info = await new Promise((res, rej) =>
      api.getThreadInfo(threadID, (err, d) => (err ? rej(err) : res(d)))
    );
  } catch {
    return api.sendMessage("❌ فشل جلب معلومات المجموعة.", threadID, messageID);
  }

  const memberList = info.participantIDs
    .slice(0, 30)
    .map((id, i) => `  ${i + 1}. ${id}`)
    .join("\n");

  const msg =
    `📋 ─── معلومات المجموعة ───\n` +
    `🆔 GID : ${threadID}\n` +
    `📝 الاسم : ${info.threadName || "—"}\n` +
    `👥 الأعضاء : ${info.participantIDs.length}\n` +
    `🛡️ المشرفون : ${info.adminIDs?.length ?? 0}\n\n` +
    `👤 قائمة الأعضاء (أول 30):\n${memberList}` +
    (info.participantIDs.length > 30
      ? `\n  … و ${info.participantIDs.length - 30} آخرين`
      : "");

  api.sendMessage(msg, threadID, messageID);
}

// ═══════════════════════════════════════════════════════════════════
//  group stats  —  إحصائيات
// ═══════════════════════════════════════════════════════════════════
async function handleStats(api, event, Threads) {
  const { threadID, messageID } = event;

  let info;
  try {
    info = await new Promise((res, rej) =>
      api.getThreadInfo(threadID, (err, d) => (err ? rej(err) : res(d)))
    );
  } catch {
    return api.sendMessage("❌ فشل جلب إحصائيات المجموعة.", threadID, messageID);
  }

  const approvalMode = info.approvalMode ? "مفعّل ✅" : "معطّل ❌";
  const msgCount = info.messageCount ?? "—";

  const msg =
    `📊 ─── إحصائيات المجموعة ───\n` +
    `🆔 GID       : ${threadID}\n` +
    `📝 الاسم     : ${info.threadName || "—"}\n` +
    `👥 الأعضاء   : ${info.participantIDs.length}\n` +
    `💬 الرسائل   : ${msgCount}\n` +
    `🔒 موافقة    : ${approvalMode}\n` +
    `📅 آخر نشاط  : ${new Date(info.timestamp).toLocaleString("ar-EG")}`;

  api.sendMessage(msg, threadID, messageID);
}

// ═══════════════════════════════════════════════════════════════════
//  group ban  —  حظر المجموعة (مطور البوت فقط: role === 2)
// ═══════════════════════════════════════════════════════════════════
async function handleBan(api, event, Threads, role) {
  const { threadID, messageID } = event;

  // يتطلب مطور بوت (role 2) — يُحسب من getUserRole في الكور
  if (role < 2)
    return api.sendMessage(
      "⛔ حظر المجموعة متاح لمطوري البوت فقط.",
      threadID,
      messageID
    );

  try {
    const data = await Threads.getData(threadID);
    if (data.banned)
      return api.sendMessage("⚠️ المجموعة محظورة بالفعل.", threadID, messageID);

    await Threads.setData(threadID, { banned: true });
    api.sendMessage(
      `🚫 تم حظر المجموعة بنجاح.\nGID: ${threadID}`,
      threadID,
      messageID
    );
  } catch {
    api.sendMessage("❌ فشل حظر المجموعة.", threadID, messageID);
  }
}

// ═══════════════════════════════════════════════════════════════════
//  group rename  —  تغيير اسم المجموعة
// ═══════════════════════════════════════════════════════════════════
async function handleRename(api, event, newName) {
  const { threadID, messageID } = event;

  if (!newName.trim())
    return api.sendMessage("⚠️ أدخل الاسم الجديد للمجموعة.", threadID, messageID);

  try {
    await new Promise((res, rej) =>
      api.setTitle(newName.trim(), threadID, (err) =>
        err ? rej(err) : res()
      )
    );
    api.sendMessage(`✅ تم تغيير اسم المجموعة إلى:\n"${newName.trim()}"`, threadID, messageID);
  } catch {
    api.sendMessage("❌ فشل تغيير اسم المجموعة.", threadID, messageID);
  }
}

// ═══════════════════════════════════════════════════════════════════
//  group admin  —  إضافة / إزالة مشرف
// ═══════════════════════════════════════════════════════════════════
async function handleAdmin(api, event, args) {
  const { threadID, messageID, mentions } = event;
  const action = (args[0] || "").toLowerCase(); // add | remove

  if (!["add", "remove"].includes(action))
    return api.sendMessage(
      "⚠️ الاستخدام:\ngroup admin add @شخص\ngroup admin remove @شخص",
      threadID,
      messageID
    );

  const targets = Object.keys(mentions || {});
  if (!targets.length)
    return api.sendMessage("⚠️ قم بمنشن الشخص المراد إضافته/إزالته.", threadID, messageID);

  const results = [];
  for (const uid of targets) {
    try {
      await new Promise((res, rej) =>
        api.changeAdminStatus(threadID, uid, action === "add", (err) =>
          err ? rej(err) : res()
        )
      );
      const name = mentions[uid]?.replace("@", "") || uid;
      results.push(`✅ ${action === "add" ? "تمت إضافة" : "تمت إزالة"} ${name}`);
    } catch {
      results.push(`❌ فشل مع المعرف ${uid}`);
    }
  }

  api.sendMessage(results.join("\n"), threadID, messageID);
}
