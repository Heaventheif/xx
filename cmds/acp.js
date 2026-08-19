// acp.js — لوحة التحكم في طلبات المراسلة المعلقة (PENDING + OTHER + SPAM)
var M = Object.defineProperty;
var u = (e, a) => M(e, "name", { value: a, configurable: !0 });

const ACCEPT_EMOJI = "✅";
const REJECT_EMOJI = "❌";
const TIMEOUT_MS   = 3e5; // 5 دقائق

// ── Helpers ─────────────────────────────────────────────────────────────────

function sendAsync(api, text, threadID, replyTo = null) {
  return new Promise((resolve, reject) => {
    global.safeSend(api, text, threadID, (err, msg) => {
      if (err) return reject(err);
      resolve(msg);
    }, replyTo);
  });
}
u(sendAsync, "sendAsync");

function threadTypeLabel(t) {
  return t.isGroup || t.threadType === "GROUP" ? "👥 مجموعة" : "👤 شخص";
}
u(threadTypeLabel, "threadTypeLabel");

function threadDisplayName(t) {
  if (t.name || t.threadName) return t.name || t.threadName;
  const ids = t.participantIDs || [];
  if (ids.length === 1) return `UID: ${ids[0]}`;
  if (ids.length === 2) {
    const bot = String(global.botApi?.getCurrentUserID?.() || "");
    return `UID: ${ids.find(p => String(p) !== bot) || ids[0]}`;
  }
  return "[بدون اسم]";
}
u(threadDisplayName, "threadDisplayName");

/**
 * جلب طلبات المراسلة من عدة مجلدات وإزالة التكرار
 * يحاول: PENDING ← OTHER ← SPAM ← UNKNOWN
 */
async function fetchAllPendingRequests(api) {
  const tags     = ["PENDING", "OTHER", "SPAM", "UNKNOWN"];
  const seen     = new Set();
  const combined = [];

  for (const tag of tags) {
    try {
      const list = await api.getThreadList(50, null, [tag]);
      if (!Array.isArray(list)) continue;
      for (const t of list) {
        const id = String(t.threadID ?? "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        combined.push({ ...t, _fetchedFrom: tag });
      }
    } catch {
      // هذا المجلد غير مدعوم — تابع
    }
  }

  return combined;
}
u(fetchAllPendingRequests, "fetchAllPendingRequests");

// ── Command ──────────────────────────────────────────────────────────────────

export default {
  config: {
    name: "acp",
    aliases: ["طلبات"],
    version: "2.0.0",
    role: 4,
    countDown: 10,
    category: "أدوات المطور",
    description: "لوحة التحكم في طلبات المراسلة المعلقة — قبول أو رفض كل طلب",
    hidden: true,
    usage: [
      "{pn}acp — عرض جميع طلبات المراسلة المعلقة",
      "{pn}acp قبول <threadID> — قبول طلب مباشرة بالمعرف",
      "{pn}acp رفض  <threadID> — رفض طلب مباشرة بالمعرف",
    ],
  },

  onStart: u(async ({ api, event, args, message }) => {
    const { threadID, messageID, senderID } = event;
    const sub = args[0]?.toLowerCase();

    // ── قبول / رفض مباشر بالـ ID ─────────────────────────────────────────
    if (sub === "قبول" || sub === "accept") {
      const tid = args[1]?.trim();
      if (!tid) return message.reply("❌ حدد معرف الخيط: acp قبول <threadID>");
      try {
        await api.handleMessageRequest(tid, true);
        return message.reply(`✅ تم قبول طلب المراسلة للخيط: ${tid}`);
      } catch (e) {
        return message.reply(`❌ فشل القبول: ${e?.message || e}`);
      }
    }

    if (sub === "رفض" || sub === "reject") {
      const tid = args[1]?.trim();
      if (!tid) return message.reply("❌ حدد معرف الخيط: acp رفض <threadID>");
      try {
        await api.handleMessageRequest(tid, false);
        return message.reply(`🚫 تم رفض طلب المراسلة للخيط: ${tid}`);
      } catch (e) {
        return message.reply(`❌ فشل الرفض: ${e?.message || e}`);
      }
    }

    // ── جلب الطلبات من كل المجلدات ───────────────────────────────────────
    let requests;
    try {
      requests = await fetchAllPendingRequests(api);
    } catch (e) {
      return message.reply(
        `❌ لم نتمكن من جلب طلبات المراسلة:\n${String(e?.message || e).slice(0, 300)}\n\n` +
        `تأكد من صحة الجلسة وأن الحساب غير مقيد.`
      );
    }

    if (requests.length === 0) {
      return message.reply("✨ لا توجد طلبات مراسلة معلقة في أي مجلد (PENDING / OTHER / SPAM).");
    }

    // ── عرض كل طلب مع Reaction Listener ──────────────────────────────────
    for (let i = 0; i < requests.length; i++) {
      const req     = requests[i];
      const gid     = req.threadID;
      const name    = threadDisplayName(req);
      const type    = threadTypeLabel(req);
      const folder  = req._fetchedFrom ?? "?";
      const preview = req.lastMessageData?.body
        ? `💬 آخر رسالة: ${String(req.lastMessageData.body).slice(0, 80)}`
        : "";

      const text =
        (i === 0
          ? `📬 الطلبات المعلقة: ${requests.length}\n${"━".repeat(28)}\nاستخدم acp قبول/رفض <threadID> أو تفاعل بـ ✅ / ❌\n\n`
          : "") +
        `📩 طلب #${i + 1}  [${folder}]\n${"─".repeat(24)}\n` +
        `${type}: ${name}\n🆔 ${gid}\n` +
        (preview ? `${preview}\n` : "") +
        `\n✅ قبول   ❌ رفض\n⏳ ينتهي الخيار بعد 5 دقائق`;

      let sentMsg;
      try {
        sentMsg = await sendAsync(api, text, threadID, messageID);
      } catch {
        continue;
      }

      if (!sentMsg?.messageID || !global.client?.reactionListener) continue;

      global.client.reactionListener[sentMsg.messageID] = {
        author: senderID,
        callback: u(async ({ api: rApi, event: rEvt }) => {
          const reaction = rEvt.reaction;
          if (reaction !== ACCEPT_EMOJI && reaction !== REJECT_EMOJI) return;

          delete global.client.reactionListener[sentMsg.messageID];
          const accept = reaction === ACCEPT_EMOJI;

          try {
            await rApi.handleMessageRequest(gid, accept);
            const label = accept
              ? `✅ تم قبول طلب المراسلة من:\n${type}: ${name}\n🆔 ${gid}`
              : `🚫 تم رفض طلب المراسلة من:\n${type}: ${name}\n🆔 ${gid}`;
            const safeApi = global.wrapApiForSafety(rApi, senderID);
            global.safeSend(safeApi, label, senderID, null, sentMsg.messageID);
          } catch (e) {
            const safeApi = global.wrapApiForSafety(rApi, senderID);
            global.safeSend(
              safeApi,
              `❌ فشلت العملية للخيط ${gid}:\n${e?.message || e}`,
              senderID, null, sentMsg.messageID
            );
          }
        }, "callback"),
      };

      setTimeout(() => {
        if (global.client?.reactionListener?.[sentMsg.messageID])
          delete global.client.reactionListener[sentMsg.messageID];
      }, TIMEOUT_MS);

      await new Promise(r => setTimeout(r, 400));
    }
  }, "onStart"),
};
