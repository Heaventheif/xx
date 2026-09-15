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

/**
 * جلب طلبات الصداقة المعلقة عبر GraphQL
 * يُعيد: [{ userID, name, mutualCount }]
 */
async function fetchFriendRequests(api) {
  try {
    const ctx = api._ctx;
    if (!ctx?.fb_dtsg || !ctx?.userID) return [];

    const form = {
      av:                          ctx.userID,
      __user:                      ctx.userID,
      __a:                         "1",
      fb_dtsg:                     ctx.fb_dtsg,
      jazoest:                     ctx.ttstamp  || "",
      lsd:                         ctx.fb_dtsg,
      fb_api_caller_class:         "RelayModern",
      fb_api_req_friendly_name:    "FriendingCometFriendRequestsRootQueryRelayPreloader",
      variables:                   JSON.stringify({ count: 30, scale: 1 }),
      server_timestamps:           "true",
      doc_id:                      "7090570720997813",
    };

    const raw = await new Promise((resolve, reject) => {
      api.httpPost(
        "https://www.facebook.com/api/graphql/",
        form,
        (err, res) => (err ? reject(err) : resolve(res))
      );
    });

    // Facebook returns text; parse safely
    let json;
    try {
      const text = typeof raw === "string" ? raw : JSON.stringify(raw);
      // Strip for_big_pipe / throw-on-error prefix
      const cleaned = text.replace(/^for \(;;\);/, "").replace(/^\s*throw[^;]+;/, "").trim();
      json = JSON.parse(cleaned);
    } catch {
      return [];
    }

    // Response structure: data.viewer.friending_possibilities.edges
    // OR data.viewer.friend_requests_v2.edges depending on FB version
    const edges =
      json?.data?.viewer?.friending_possibilities?.edges ||
      json?.data?.viewer?.friend_requests_v2?.edges ||
      json?.data?.viewer?.friend_requests?.edges ||
      [];

    return edges.map(e => {
      const node = e?.node ?? e;
      return {
        userID:      String(node?.id ?? node?.userID ?? ""),
        name:        node?.name ?? node?.profile_picture?.label ?? "مجهول",
        mutualCount: node?.mutual_friends?.count ?? node?.mutualFriendCount ?? 0,
      };
    }).filter(r => r.userID);

  } catch {
    return [];
  }
}
u(fetchFriendRequests, "fetchFriendRequests");

/**
 * قبول طلب صداقة بـ UID عبر GraphQL mutation
 * يستخدم acpUser factory إذا كان متاحاً، وإلا يتراجع لـ handleFriendRequest
 */
async function acceptFriendRequest(api, userID) {
  const ctx = api._ctx;

  // محاولة 1: GraphQL mutation (أدق)
  if (ctx?.fb_dtsg && ctx?.userID) {
    try {
      const form = {
        av:                          ctx.userID,
        __user:                      ctx.userID,
        __a:                         "1",
        fb_dtsg:                     ctx.fb_dtsg,
        jazoest:                     ctx.ttstamp || "",
        lsd:                         ctx.fb_dtsg,
        fb_api_caller_class:         "RelayModern",
        fb_api_req_friendly_name:    "FriendingCometFriendRequestConfirmMutation",
        variables: JSON.stringify({
          input: {
            source:               "friends_tab",
            friend_requester_id:  String(userID),
            actor_id:             ctx.userID,
            client_mutation_id:   String(Math.floor(Math.random() * 1e9)),
          },
        }),
        server_timestamps: "true",
        doc_id:            "6003738476371496",
      };
      const raw = await new Promise((resolve, reject) => {
        api.httpPost(
          "https://www.facebook.com/api/graphql/",
          form,
          (err, res) => (err ? reject(err) : resolve(res))
        );
      });
      const text    = typeof raw === "string" ? raw : JSON.stringify(raw);
      const cleaned = text.replace(/^for \(;;\);/, "").replace(/^\s*throw[^;]+;/, "").trim();
      const json    = JSON.parse(cleaned);
      if (json?.errors?.length) throw new Error(JSON.stringify(json.errors[0]));
      return { ok: true };
    } catch (e) {
      // تراجع للطريقة القديمة
    }
  }

  // محاولة 2: handleFriendRequest الكلاسيكي
  return new Promise((resolve, reject) => {
    api.handleFriendRequest(userID, true, (err) => {
      if (err) return reject(err);
      resolve({ ok: true });
    });
  });
}
u(acceptFriendRequest, "acceptFriendRequest");

async function rejectFriendRequest(api, userID) {
  return new Promise((resolve, reject) => {
    api.handleFriendRequest(userID, false, (err) => {
      if (err) return reject(err);
      resolve({ ok: true });
    });
  });
}
u(rejectFriendRequest, "rejectFriendRequest");

export default {
  config: {
    name: "acp",
    aliases: ["طلبات"],
    version: "2.1.0",
    role: 2,
    countDown: 10,
    category: "أدوات المطور",
    description: "لوحة التحكم في طلبات المراسلة والصداقة المعلقة — قبول أو رفض كل طلب",
    hidden: true,
    usage: [
      "{pn}acp — عرض جميع طلبات المراسلة والصداقة المعلقة",
      "{pn}acp قبول <threadID> — قبول طلب مراسلة بالمعرف",
      "{pn}acp رفض  <threadID> — رفض طلب مراسلة بالمعرف",
      "{pn}acp صديق قبول <userID> — قبول طلب صداقة بالـ UID",
      "{pn}acp صديق رفض  <userID> — رفض طلب صداقة بالـ UID",
    ],
  },
  onStart: u(async ({ api, event, args, message }) => {
    const { threadID, messageID, senderID } = event;
    if (!global._acpLocks) global._acpLocks = new Set();
    if (global._acpLocks.has(senderID)) {
      return message.reply("⏳ جاري معالجة طلب سابق، انتظر قليلاً...");
    }
    global._acpLocks.add(senderID);
    const _acpLockTimer = setTimeout(() => global._acpLocks?.delete(senderID), 5 * 60 * 1000);
    try {

      const sub = args[0]?.toLowerCase();

      // ── acp قبول/رفض <threadID> — طلبات المراسلة ──────────────────
      if (sub === "قبول" || sub === "accept") {
        const tid = args[1]?.trim();
        if (!tid) return message.reply("❌ حدد معرف الخيط: acp قبول <threadID>");
        try {
          await api.handleMessageRequest(tid, true);
          return message.reply(`✅ تم قبول طلب المراسلة للخيط: ${tid}`);
        } catch (e) {
          const code = e?.error ?? e?.error_code;
          if (code === 1357031)
            return message.reply(`⚠️ فيسبوك رافض القبول لأن المحتوى لم يعد موجودًا من ناحيته — الطلب عالق بشكل دائم.`);
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
          if (code === 1357031)
            return message.reply(`⚠️ فيسبوك رافض الرفض لأن المحتوى لم يعد موجودًا — الطلب عالق بشكل دائم.`);
          return message.reply(`❌ فشل الرفض: ${safeStringify(e)}`);
        }
      }

      // ── acp صديق قبول/رفض <userID> — طلبات الصداقة ──────────────
      if (sub === "صديق" || sub === "friend") {
        const action = args[1]?.toLowerCase();
        const uid    = args[2]?.trim();
        if (!uid) return message.reply("❌ حدد الـ UID: acp صديق قبول/رفض <userID>");
        if (action === "قبول" || action === "accept") {
          try {
            await acceptFriendRequest(api, uid);
            return message.reply(`✅ تم قبول طلب الصداقة من UID: ${uid}`);
          } catch (e) {
            return message.reply(`❌ فشل القبول: ${safeStringify(e)}`);
          }
        }
        if (action === "رفض" || action === "reject") {
          try {
            await rejectFriendRequest(api, uid);
            return message.reply(`🚫 تم رفض طلب الصداقة من UID: ${uid}`);
          } catch (e) {
            return message.reply(`❌ فشل الرفض: ${safeStringify(e)}`);
          }
        }
        return message.reply("❌ الأمر غير معروف. استخدم: acp صديق قبول/رفض <userID>");
      }

      // ── عرض جميع الطلبات ───────────────────────────────────────────
      // جلب طلبات المراسلة وطلبات الصداقة بالتوازي
      const [msgRequests, friendRequests] = await Promise.all([
        fetchAllPendingRequests(api).catch(() => []),
        fetchFriendRequests(api).catch(() => []),
      ]);

      const totalMsg    = msgRequests.length;
      const totalFriend = friendRequests.length;
      const total       = totalMsg + totalFriend;

      if (total === 0) {
        return message.reply("✨ لا توجد طلبات معلقة (لا مراسلة ولا صداقة).");
      }

      // ── قسم طلبات الصداقة ─────────────────────────────────────────
      if (totalFriend > 0) {
        let friendText = `👥 طلبات الصداقة: ${totalFriend}\n${"━".repeat(28)}\n`;
        friendText    += `استخدم: acp صديق قبول/رفض <userID>\n\n`;
        for (let i = 0; i < friendRequests.length; i++) {
          const { userID, name, mutualCount } = friendRequests[i];
          friendText +=
            `👤 #${i + 1} ${name}\n` +
            `🆔 ${userID}\n` +
            (mutualCount ? `👫 أصدقاء مشتركون: ${mutualCount}\n` : "") +
            `\n`;
        }
        friendText += `مثال: acp صديق قبول ${friendRequests[0]?.userID}`;
        try { await sendAsync(api, friendText, threadID, messageID); } catch (_) {}
        await new Promise(r => setTimeout(r, 500));
      }

      // ── قسم طلبات المراسلة (التفاعلي) ────────────────────────────
      if (totalMsg === 0) {
        return message.reply("💬 لا توجد طلبات مراسلة معلقة في PENDING / OTHER / SPAM.");
      }

      for (let i = 0; i < msgRequests.length; i++) {
        const req     = msgRequests[i];
        const gid     = req.threadID;
        const name    = threadDisplayName(req);
        const type    = threadTypeLabel(req);
        const folder  = req._fetchedFrom ?? "?";
        const preview = req.lastMessageData?.body
          ? `💬 آخر رسالة: ${String(req.lastMessageData.body).slice(0, 80)}`
          : "";
        const text =
          (i === 0
            ? `📬 طلبات المراسلة: ${totalMsg}\n${"━".repeat(28)}\nاستخدم acp قبول/رفض <threadID>، أو ردّ بـ "ق" للقبول / "ر" للرفض، أو تفاعل بـ ✅ / ❌\n\n`
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
            const safeApi = typeof global.wrapApiForSafety === "function" ? global.wrapApiForSafety(rawApi) : rawApi;
            global.safeSend(safeApi, label, senderID, null, sentMsg.messageID);
          } catch (e) {
            const safeApi = typeof global.wrapApiForSafety === "function" ? global.wrapApiForSafety(rawApi) : rawApi;
            const code = e?.error ?? e?.error_code;
            const msg = (code === 1357031)
              ? `⚠️ فيسبوك رافض أي إجراء على هذا الطلب لأن المحتوى لم يعد موجودًا:\n${type}: ${name}\n🆔 ${gid}`
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
                const safeApi = typeof global.wrapApiForSafety === "function" ? global.wrapApiForSafety(rApi) : rApi;
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

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-commands-admin-acp',
  meta: { category: 'command-admin', path: 'src/commands/admin/acp.js' },
  setup(_ctx) {
    // see module exports
  },
};
