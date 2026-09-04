var M = Object.defineProperty;
var u = (e, a) => M(e, "name", { value: a, configurable: !0 });
const ACCEPT_EMOJI = "✅";
const REJECT_EMOJI = "❌";
const TIMEOUT_MS   = 3e5; 
function safeStringify(v) {
  if (v instanceof Error) return v.message;
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}
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
    }
  }
  return combined;
}
u(fetchAllPendingRequests, "fetchAllPendingRequests");
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
    // M-03 fix: per-user lock prevents race condition on rapid invocations
    if (!global._acpLocks) global._acpLocks = new Set();
    if (global._acpLocks.has(senderID)) {
      return message.reply("⏳ جاري معالجة طلب سابق، انتظر قليلاً...");
    }
    global._acpLocks.add(senderID);
    const _acpLockTimer = setTimeout(() => global._acpLocks?.delete(senderID), 5 * 60 * 1000);
    try {
    const sub = args[0]?.toLowerCase();
    if (sub === "قبول" || sub === "accept") {
      const tid = args[1]?.trim();
      if (!tid) return message.reply("❌ حدد معرف الخيط: acp قبول <threadID>");
      try {
        await api.handleMessageRequest(tid, true);
        return message.reply(`✅ تم قبول طلب المراسلة للخيط: ${tid}`);
      } catch (e) {
        const code = e?.error ?? e?.error_code;
        if (code === 1357031) {
          return message.reply(`⚠️ فيسبوك رافض القبول لأن المحتوى لم يعد موجودًا من ناحيته — الطلب عالق بشكل دائم وليس خطأً في البوت.`);
        }
        return message.reply(`❌ فشل القبول: ${safeStringify(e)}`);
      }
    }
    if (sub === "رفض" || sub === "reject") {
      const tid = args[1]?.trim();
      if (!tid) return message.reply("❌ حدد معرف الخيط: acp رفض <threadID>");
      try {
        await api.handleMessageRequest(tid, false);
        return message.reply(`🚫 تم رفض طلب المراسلة للخيط: ${tid}`);
      } catch (e) {
        const code = e?.error ?? e?.error_code;
        if (code === 1357031) {
          return message.reply(`⚠️ فيسبوك رافض الرفض كمان لأن المحتوى لم يعد موجودًا من ناحيته — الطلب عالق بشكل دائم وليس خطأً في البوت. بوتك بالفعل بيتوقف عن إعادة محاولته تلقائيًا في الـ sweep الدوري.`);
        }
        return message.reply(`❌ فشل الرفض: ${safeStringify(e)}`);
      }
    }
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
          ? `📬 الطلبات المعلقة: ${requests.length}\n${"━".repeat(28)}\nاستخدم acp قبول/رفض <threadID>، أو ردّ على هذه الرسالة بـ "ق" للقبول / "ر" للرفض، أو تفاعل بـ ✅ / ❌\n\n`
          : "") +
        `📩 طلب #${i + 1}  [${folder}]\n${"─".repeat(24)}\n` +
        `${type}: ${name}\n🆔 ${gid}\n` +
        (preview ? `${preview}\n` : "") +
        `\nردّ بـ "ق" للقبول أو "ر" للرفض\n⏳ ينتهي الخيار بعد 5 دقائق`;
      let sentMsg;
      try {
        sentMsg = await sendAsync(api, text, threadID, messageID);
      } catch {
        continue;
      }
      if (!sentMsg?.messageID) continue;
      let settled = false;
      const decide = u(async (accept, rawApi) => {
        if (settled) return;
        settled = true;
        if (global.client?.reactionListener) delete global.client.reactionListener[sentMsg.messageID];
        if (global.Kagenou?.replies) delete global.Kagenou.replies[sentMsg.messageID];
        try {
          await rawApi.handleMessageRequest(gid, accept);
          const label = accept
            ? `✅ تم قبول طلب المراسلة من:\n${type}: ${name}\n🆔 ${gid}`
            : `🚫 تم رفض طلب المراسلة من:\n${type}: ${name}\n🆔 ${gid}`;
          const safeApi = typeof global.wrapApiForSafety === "function" ? global.wrapApiForSafety(rawApi, senderID) : rawApi;
          global.safeSend(safeApi, label, senderID, null, sentMsg.messageID);
        } catch (e) {
          const safeApi = typeof global.wrapApiForSafety === "function" ? global.wrapApiForSafety(rawApi, senderID) : rawApi;
          const code = e?.error ?? e?.error_code;
          const msg = (code === 1357031)
            ? `⚠️ فيسبوك رافض أي إجراء (قبول/رفض) على هذا الطلب لأن المحتوى نفسه لم يعد موجودًا من ناحيته:\n${type}: ${name}\n🆔 ${gid}\n\nده مش خطأ في البوت — الطلب ده عالق بشكل دائم من طرف فيسبوك ومفيش داعي تعيد المحاولة.`
            : `❌ فشلت العملية للخيط ${gid}:\n${safeStringify(e)}`;
          global.safeSend(safeApi, msg, senderID, null, sentMsg.messageID);
        }
      }, "decide");
      if (global.client?.reactionListener) {
        global.client.reactionListener[sentMsg.messageID] = {
          author: senderID,
          callback: u(async ({ api: rApi, event: rEvt }) => {
            const reaction = rEvt.reaction;
            if (reaction !== ACCEPT_EMOJI && reaction !== REJECT_EMOJI) return;
            await decide(reaction === ACCEPT_EMOJI, rApi);
          }, "callback"),
        };
      }
      if (global.Kagenou) {
        global.Kagenou.replies = global.Kagenou.replies || {};
        global.Kagenou.replies[sentMsg.messageID] = {
          author: senderID,
          onReply: u(async ({ api: rApi, event: rEvt }) => {
            const body = (rEvt.body || "").trim();
            const isAccept = ["ق", "قبول", "accept", "y", "نعم"].includes(body);
            const isReject = ["ر", "رفض", "reject", "n", "لا"].includes(body);
            if (!isAccept && !isReject) {
              const safeApi = typeof global.wrapApiForSafety === "function" ? global.wrapApiForSafety(rApi, senderID) : rApi;
              global.safeSend(
                safeApi,
                `⚠️ لم أفهم "${body}" — الرد اتلغى. أرسل acp تاني وردّ بـ "ق" للقبول أو "ر" للرفض.`,
                senderID, null, sentMsg.messageID
              );
              settled = true;
              if (global.client?.reactionListener) delete global.client.reactionListener[sentMsg.messageID];
              return;
            }
            await decide(isAccept, rApi);
          }, "onReply"),
        };
      }
      setTimeout(() => {
        settled = true;
        if (global.client?.reactionListener?.[sentMsg.messageID])
          delete global.client.reactionListener[sentMsg.messageID];
        if (global.Kagenou?.replies?.[sentMsg.messageID])
          delete global.Kagenou.replies[sentMsg.messageID];
      }, TIMEOUT_MS);
      await new Promise(r => setTimeout(r, 400));
    }
    } finally {
      clearTimeout(_acpLockTimer);
      global._acpLocks?.delete(senderID);
    }
  }, "onStart"),
};
