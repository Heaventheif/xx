/**
 * kick.js — طرد عضو من المجموعة
 * تحسينات v1.4.0:
 *   - دعم طرد متعدد (منشن أكثر من شخص)
 *   - رسائل خطأ أوضح مع تمييز حالة "مشرف"
 *   - حماية من طرد البوت نفسه
 */
export default {
  config: {
    name: "kick",
    aliases: ["طرد"],
    version: "1.4.0",
    author: "sunken",
    countDown: 5,
    role: 0,
    category: "إدارة وإشراف",
    description: "طرد عضو (أو أكثر) من المجموعة — منشن أو ID أو رد",
    usage: [
      "{pn}طرد @شخص — طرد عضو بالمنشن",
      "{pn}طرد @شخص1 @شخص2 — طرد عدة أعضاء",
      "{pn}طرد <UID> — طرد بالـ ID مباشرة",
      "رد على رسالة + {pn}طرد — طرد صاحب الرسالة",
    ],
  },

  onStart: async ({ api, event, args, message, isGroupAdmin }) => {
    const { threadID, senderID, mentions, messageReply } = event;

    if (!isGroupAdmin) {
      return message.reply("❌ هذا الأمر لمشرفي المجموعة فقط!");
    }

    const botID = String(api.getCurrentUserID());

    // ── تحديد الأهداف ────────────────────────────────────────────
    const targets = []; // [{id, name}]
    const mentionIDs = Object.keys(mentions);

    if (mentionIDs.length > 0) {
      for (const id of mentionIDs) {
        targets.push({ id, name: mentions[id].replace(/@/g, " ").trim() });
      }
    } else if (args.length > 0 && /^\d{5,20}$/.test(args[0].trim())) {
      targets.push({ id: args[0].trim(), name: `(ID: ${args[0].trim()})` });
    } else if (messageReply) {
      targets.push({ id: messageReply.senderID, name: "صاحب الرسالة" });
    }

    if (!targets.length) {
      return message.reply("❌ حدد العضو المراد طرده (منشن، ID، أو رد).");
    }

    // ── تصفية غير المسموح بطردهم ─────────────────────────────────
    const invalid = targets.filter(
      (t) => String(t.id) === botID || String(t.id) === String(senderID)
    );
    if (invalid.length) {
      const names = invalid.map((t) => t.name).join("، ");
      if (String(invalid[0].id) === botID) {
        return message.reply("🤣 لا يمكنني طرد نفسي!");
      }
      return message.reply("🤔 لا يمكنك طرد نفسك!");
    }

    // ── تنفيذ الطرد ──────────────────────────────────────────────
    const kicked = [], failed = [];

    for (const target of targets) {
      try {
        await api.removeUserFromGroup(target.id, threadID);
        kicked.push(target.name);
      } catch (err) {
        const msg = err?.message || "";
        if (msg.includes("admin") || msg.includes("1545012") || msg.includes("not authorized")) {
          failed.push(`${target.name} (مشرف — لا يمكن طرده)`);
        } else {
          failed.push(`${target.name} (خطأ غير متوقع)`);
        }
      }
    }

    const lines = [];
    if (kicked.length)  lines.push(`♻️ تم طرد: ${kicked.join("، ")} 👋`);
    if (failed.length)  lines.push(`⚠️ فشل طرد: ${failed.join("، ")}`);

    return message.reply(lines.join("\n"));
  },
};

// ─── Plugin Descriptor ───────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: "xx-commands-admin-kick",
  meta: { category: "command-admin", path: "src/commands/admin/kick.js" },
  setup(_ctx) {},
};
