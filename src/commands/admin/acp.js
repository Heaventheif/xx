var M = Object.defineProperty;
var u = (e, a) => M(e, "name", { value: a, configurable: !0 });
import acpUserFactory from "../../../fca-unofficial/lib/external-apis/action/acpUser.js";

const ACP_DEV = String(process.env.DEV || "").trim().toLowerCase() === "on";
function acpDebug(message, details = {}) {
  if (!ACP_DEV) return;
  const safe = { ...details };
  delete safe.raw;
  delete safe.body;
  delete safe.response;
  delete safe.token;
  delete safe.cookie;
  console.error(`[ACP-DEV] ${message}`, safe);
}

function parseFacebookResponse(raw) {
  if (raw && typeof raw === "object") return raw;
  const text = String(raw ?? "")
    .replace(/^for \(;;\);/, "")
    .replace(/^\s*throw[^;]+;/, "")
    .trim();
  try { return JSON.parse(text); } catch {}
  // Some GraphQL responses are newline-delimited JSON records.
  const records = text.split(/\r?\n/).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  if (records.length === 1) return records[0];
  if (records.length > 1) return { __records: records };
  throw new Error("Facebook returned a non-JSON response");
}

function collectFriendNodes(value, output = [], seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return output;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectFriendNodes(item, output, seen);
    return output;
  }
  const id = value.id ?? value.userID ?? value.user_id ?? value.uid;
  const name = value.name ?? value.full_name ?? value.title;
  if (id && name && !String(id).includes(":")) output.push(value);
  for (const child of Object.values(value)) collectFriendNodes(child, output, seen);
  return output;
}

function getAuthContext(api) {
  const botIndex = api?.__botIndex ?? api?.botIndex ?? 1;
  return api?._ctx || api?.ctx || global.__fcaContexts?.get(botIndex) || global.__fcaContexts?.[botIndex] || null;
}
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
    const ctx = getAuthContext(api);
    if (!ctx?.fb_dtsg || !ctx?.userID) {
      throw new Error("Missing authenticated fb_dtsg/userID context");
    }

    const form = {
      av:                          ctx.userID,
      __user:                      ctx.userID,
      __a:                         "1",
      fb_dtsg:                     ctx.fb_dtsg,
      jazoest:                     ctx.ttstamp  || "",
      lsd:                         ctx.lsd || ctx.lsdToken || ctx.fb_dtsg,
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
      json = parseFacebookResponse(cleaned);
    } catch (error) {
      acpDebug("response parse failed", { error: error.message });
      throw error;
    }

    const errors = json?.errors || json?.__records?.flatMap((r) => r?.errors || []) || [];
    if (errors.length) {
      const error = new Error(String(errors[0]?.message || "Facebook GraphQL error"));
      error.code = errors[0]?.code;
      acpDebug("Facebook rejected friend-request query", { code: error.code, message: error.message });
      throw error;
    }

    // Response structure: data.viewer.friending_possibilities.edges
    // OR data.viewer.friend_requests_v2.edges depending on FB version
    const edges =
      json?.data?.viewer?.friending_possibilities?.edges ||
      json?.data?.viewer?.friend_requests_v2?.edges ||
      json?.data?.viewer?.friend_requests?.edges ||
      [];

    const candidates = edges.length ? edges.map((e) => e?.node ?? e) : collectFriendNodes(json);
    const unique = new Map();
    for (const node of candidates) {
      const userID = String(node?.id ?? node?.userID ?? node?.user_id ?? node?.uid ?? "");
      if (!userID || unique.has(userID)) continue;
      unique.set(userID, {
        userID,
        name: node?.name ?? node?.full_name ?? node?.profile_picture?.label ?? "مجهول",
        mutualCount: node?.mutual_friends?.count ?? node?.mutualFriendCount ?? 0,
      });
    }
    acpDebug("friend-request query completed", { explicitEdges: edges.length, candidateCount: unique.size });
    return [...unique.values()];
  } catch (error) {
    acpDebug("friend-request query failed", { code: error?.code, message: error?.message || String(error) });
    throw error;
  }
}
u(fetchFriendRequests, "fetchFriendRequests");

/**
 * قبول طلب صداقة بـ UID عبر GraphQL mutation
 * يستخدم acpUser factory إذا كان متاحاً، وإلا يتراجع لـ handleFriendRequest
 */
async function acceptFriendRequest(api, userID) {
  const ctx = getAuthContext(api);

  // Prefer the maintained FCA mutation implementation. It includes the
  // requester UID; the legacy handleFriendRequest fallback does not.
  if (typeof api._defaultFuncs?.post === "function" && ctx?.userID) {
    try {
      const acpUser = acpUserFactory(api._defaultFuncs, api, ctx);
      return await acpUser(String(userID));
    } catch (_) {
      // Continue to the local GraphQL/fallback paths for compatibility.
    }
  }

  // محاولة 1: GraphQL mutation (أدق)
  if (ctx?.fb_dtsg && ctx?.userID) {
    try {
      const form = {
        av:                          ctx.userID,
        __user:                      ctx.userID,
        __a:                         "1",
        fb_dtsg:                     ctx.fb_dtsg,
        jazoest:                     ctx.ttstamp || "",
        lsd:                         ctx.lsd || ctx.lsdToken || ctx.fb_dtsg,
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
        return message.reply("🚫 قبول طلبات الرسائل الخاصة معطّل: البوت يعمل في المجموعات فقط.");
      }
      if (sub === "رفض" || sub === "reject") {
        return message.reply("🚫 رفض طلبات الرسائل الخاصة معطّل: البوت يعمل في المجموعات فقط.");
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

      // ── عرض طلبات الصداقة فقط ─────────────────────────────────────
      // لا نستعلم عن PENDING/OTHER/SPAM لأنها صناديق رسائل خاصة.
      const friendResult = await Promise.allSettled([fetchFriendRequests(api)]);
      const msgRequests = [];
      const friendRequests = friendResult[0].status === "fulfilled" ? friendResult[0].value : [];
      const friendQueryError = friendResult[0].status === "rejected" ? friendResult[0].reason : null;

      const totalMsg    = msgRequests.length;
      const totalFriend = friendRequests.length;
      const total       = totalMsg + totalFriend;

      if (total === 0 && friendQueryError) {
        return message.reply(`⚠️ تعذر جلب طلبات الصداقة من Facebook: ${safeStringify(friendQueryError)}\nفعّل DEV=on للتشخيص الآمن.`);
      }
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
