"use strict";

// ✅ لا حاجة لـ permission.js — الكور يتحقق من config.role تلقائياً قبل run()
// role: 1 = مشرف المجموعة | 2 = مطور البوت فقط

const _config = {
  name: "group",
  version: "2.1.0",
  author: "dev",
  countDown: 5,
  role: 1,
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
};

export default {
  config: _config,

  // ─── نقطة الدخول ────────────────────────────────────────────────
  run: async function ({ api, event, args, role, Threads, Users, prefix }) {
    const { threadID, messageID } = event;
    const sub = (args[0] || "").toLowerCase();

    switch (sub) {
      case "info":
        return handleInfo(api, event);
      case "stats":
        return handleStats(api, event);
      case "ban":
        return handleBan(api, event, Threads, role);
      case "rename":
        return handleRename(api, event, args.slice(1).join(" "));
      case "admin":
        return handleAdmin(api, event, args.slice(1));
      default:
        return api.sendMessage(
          `❓ الاستخدام:\n${_config.guide.ar.replace(/{pn}/g, prefix + "group")}`,
          threadID,
          null,
          messageID
        );
    }
  },
};

// ═══════════════════════════════════════════════════════════════════
//  group info  —  GID + قائمة الأعضاء
// ═══════════════════════════════════════════════════════════════════
async function handleInfo(api, event) {
  const { threadID, messageID } = event;

  let info;
  try {
    info = await api.getThreadInfo(threadID);
  } catch {
    return api.sendMessage("❌ فشل جلب معلومات المجموعة.", threadID, null, messageID);
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

  api.sendMessage(msg, threadID, null, messageID);
}

// ═══════════════════════════════════════════════════════════════════
//  group stats  —  إحصائيات
// ═══════════════════════════════════════════════════════════════════
async function handleStats(api, event) {
  const { threadID, messageID } = event;

  let info;
  try {
    info = await api.getThreadInfo(threadID);
  } catch {
    return api.sendMessage("❌ فشل جلب إحصائيات المجموعة.", threadID, null, messageID);
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

  api.sendMessage(msg, threadID, null, messageID);
}

// ═══════════════════════════════════════════════════════════════════
//  group ban  —  حظر المجموعة (مطور البوت فقط: role === 2)
// ═══════════════════════════════════════════════════════════════════
async function handleBan(api, event, Threads, role) {
  const { threadID, messageID } = event;

  if (role < 2)
    return api.sendMessage(
      "⛔ حظر المجموعة متاح لمطوري البوت فقط.",
      threadID,
      null,
      messageID
    );

  try {
    const data = await Threads.getData(threadID);
    if (data.banned)
      return api.sendMessage("⚠️ المجموعة محظورة بالفعل.", threadID, null, messageID);

    await Threads.setData(threadID, { banned: true });
    api.sendMessage(
      `🚫 تم حظر المجموعة بنجاح.\nGID: ${threadID}`,
      threadID,
      null,
      messageID
    );
  } catch {
    api.sendMessage("❌ فشل حظر المجموعة.", threadID, null, messageID);
  }
}

// ═══════════════════════════════════════════════════════════════════
//  group rename  —  تغيير اسم المجموعة
// ═══════════════════════════════════════════════════════════════════
async function handleRename(api, event, newName) {
  const { threadID, messageID } = event;

  if (!newName.trim())
    return api.sendMessage("⚠️ أدخل الاسم الجديد للمجموعة.", threadID, null, messageID);

  try {
    await api.setTitle(newName.trim(), threadID);
    api.sendMessage(`✅ تم تغيير اسم المجموعة إلى:\n"${newName.trim()}"`, threadID, null, messageID);
  } catch {
    api.sendMessage("❌ فشل تغيير اسم المجموعة.", threadID, null, messageID);
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
      null,
      messageID
    );

  const targets = Object.keys(mentions || {});
  if (!targets.length)
    return api.sendMessage("⚠️ قم بمنشن الشخص المراد إضافته/إزالته.", threadID, null, messageID);

  const results = [];
  for (const uid of targets) {
    try {
      await api.changeAdminStatus(threadID, uid, action === "add");
      const name = mentions[uid]?.replace("@", "") || uid;
      results.push(`✅ ${action === "add" ? "تمت إضافة" : "تمت إزالة"} ${name}`);
    } catch {
      results.push(`❌ فشل مع المعرف ${uid}`);
    }
  }

  api.sendMessage(results.join("\n"), threadID, null, messageID);
}

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-commands-admin-group',
  meta: { category: 'command-admin', path: 'src/cmds/group.js' },
  setup(_ctx) {
    // see module exports
  },
};
