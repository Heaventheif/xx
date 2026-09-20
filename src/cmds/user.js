"use strict";

// ✅ لا حاجة لـ permission.js — الكور يتحقق من config.role تلقائياً قبل run()
// role: 1 = مشرف المجموعة | 2 = مطور البوت فقط

const _config = {
  name: "user",
  version: "2.1.0",
  author: "dev",
  countDown: 5,
  role: 1,
  description: {
    ar: "إدارة المستخدمين: معرف، اسم، طرد، حظر، إضافة",
  },
  category: "admin",
  guide: {
    ar:
      "{pn} id @شخص          — عرض UID الشخص\n" +
      "{pn} name @شخص <اسم>  — تغيير اللقب\n" +
      "{pn} kick @شخص        — طرد من المجموعة\n" +
      "{pn} ban @شخص         — حظر المستخدم من البوت (مطور فقط)\n" +
      "{pn} add <UID>         — إضافة مستخدم للمجموعة",
  },
};

export default {
  config: _config,

  // ─── نقطة الدخول ────────────────────────────────────────────────
  run: async function ({ api, event, args, role, Users, Threads, prefix }) {
    const { threadID, messageID } = event;
    const sub = (args[0] || "").toLowerCase();

    switch (sub) {
      case "id":
        return handleID(api, event);
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
          `❓ الاستخدام:\n${_config.guide.ar.replace(/{pn}/g, prefix + "user")}`,
          threadID,
          null,
          messageID
        );
    }
  },
};

// ═══════════════════════════════════════════════════════════════════
//  user id  —  عرض UID
// ═══════════════════════════════════════════════════════════════════
async function handleID(api, event) {
  const { threadID, messageID, mentions, senderID } = event;

  const targets = Object.keys(mentions || {});

  if (!targets.length) {
    return api.sendMessage(
      `🆔 معرّفك (UID): ${senderID}`,
      threadID,
      null,
      messageID
    );
  }

  const lines = targets.map((uid) => {
    const name = (mentions[uid] || "").replace("@", "") || uid;
    return `👤 ${name}\n🆔 UID: ${uid}`;
  });

  api.sendMessage(lines.join("\n\n"), threadID, null, messageID);
}

// ═══════════════════════════════════════════════════════════════════
//  user name  —  تغيير اللقب (nickname)
// ═══════════════════════════════════════════════════════════════════
async function handleName(api, event, args) {
  const { threadID, messageID, mentions } = event;

  const targets = Object.keys(mentions || {});
  if (!targets.length)
    return api.sendMessage("⚠️ قم بمنشن الشخص المراد تغيير لقبه.", threadID, null, messageID);

  const newName = args
    .filter((a) => !a.startsWith("@") && !/^\d+$/.test(a))
    .join(" ")
    .trim();

  if (!newName)
    return api.sendMessage(
      "⚠️ أدخل الاسم الجديد بعد المنشن.\nمثال: user name @شخص الاسم الجديد",
      threadID,
      null,
      messageID
    );

  const results = [];
  for (const uid of targets) {
    try {
      await api.changeNickname(newName, threadID, uid);
      const name = (mentions[uid] || "").replace("@", "") || uid;
      results.push(`✅ تم تغيير لقب ${name} إلى "${newName}"`);
    } catch {
      results.push(`❌ فشل تغيير لقب ${uid}`);
    }
  }

  api.sendMessage(results.join("\n"), threadID, null, messageID);
}

// ═══════════════════════════════════════════════════════════════════
//  user kick  —  طرد من المجموعة
// ═══════════════════════════════════════════════════════════════════
async function handleKick(api, event) {
  const { threadID, messageID, mentions, senderID } = event;

  const targets = Object.keys(mentions || {});
  if (!targets.length)
    return api.sendMessage("⚠️ قم بمنشن الشخص المراد طرده.", threadID, null, messageID);

  if (targets.includes(senderID))
    return api.sendMessage("⚠️ لا يمكنك طرد نفسك.", threadID, null, messageID);

  const results = [];
  for (const uid of targets) {
    try {
      await api.removeUserFromGroup(uid, threadID);
      const name = (mentions[uid] || "").replace("@", "") || uid;
      results.push(`✅ تم طرد ${name}`);
    } catch {
      results.push(`❌ فشل طرد ${uid} — تحقق من صلاحيات البوت`);
    }
  }

  api.sendMessage(results.join("\n"), threadID, null, messageID);
}

// ═══════════════════════════════════════════════════════════════════
//  user ban  —  حظر المستخدم من البوت (مطور البوت فقط: role === 2)
// ═══════════════════════════════════════════════════════════════════
async function handleBan(api, event, Users, role) {
  const { threadID, messageID, mentions } = event;

  if (role < 2)
    return api.sendMessage(
      "⛔ حظر المستخدمين متاح لمطوري البوت فقط.",
      threadID,
      null,
      messageID
    );

  const targets = Object.keys(mentions || {});
  if (!targets.length)
    return api.sendMessage("⚠️ قم بمنشن الشخص المراد حظره.", threadID, null, messageID);

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

  api.sendMessage(results.join("\n"), threadID, null, messageID);
}

// ═══════════════════════════════════════════════════════════════════
//  user add  —  إضافة مستخدم للمجموعة
// ═══════════════════════════════════════════════════════════════════
async function handleAdd(api, event, args) {
  const { threadID, messageID, mentions } = event;

  let targets = Object.keys(mentions || {});
  if (!targets.length) {
    targets = args.filter((a) => /^\d{10,}$/.test(a));
  }

  if (!targets.length)
    return api.sendMessage(
      "⚠️ قم بمنشن الشخص أو أدخل UID الشخص المراد إضافته.\nمثال: user add 100012345678",
      threadID,
      null,
      messageID
    );

  const results = [];
  for (const uid of targets) {
    try {
      await api.addUserToGroup(uid, threadID);
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

  api.sendMessage(results.join("\n"), threadID, null, messageID);
}

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-commands-admin-user',
  meta: { category: 'command-admin', path: 'src/cmds/user.js' },
  setup(_ctx) {
    // see module exports
  },
};
