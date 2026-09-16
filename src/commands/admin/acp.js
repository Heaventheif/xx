/**
 * acp.js — إدارة طلبات المراسلة والصداقة
 * v4.0.0 — مُبسَّط ومُنظَّم، يعتمد على FCA المحسَّنة مباشرةً
 *
 * الأوامر:
 *   acp                        — عرض جميع طلبات المراسلة المعلقة
 *   acp قبول <threadID>        — قبول طلب مراسلة
 *   acp رفض <threadID>         — رفض طلب مراسلة
 *   acp صديق قبول <userID>     — قبول طلب صداقة
 *   acp صديق رفض <userID>      — رفض طلب صداقة
 *   acp صديق قائمة            — عرض طلبات الصداقة المعلقة
 */

// ─── مساعدات ────────────────────────────────────────────────────

function safe(v) {
  if (v instanceof Error) return v.message;
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

/**
 * جلب جميع الطلبات المعلقة من مجلدات PENDING / OTHER / SPAM / UNKNOWN
 */
async function fetchPendingThreads(api) {
  const tags    = ["PENDING", "OTHER", "SPAM", "UNKNOWN"];
  const seen    = new Set();
  const results = [];

  for (const tag of tags) {
    try {
      const list = await api.getThreadList(50, null, [tag]);
      if (!Array.isArray(list)) continue;
      for (const t of list) {
        const id = String(t?.threadID || "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        results.push({ ...t, _folder: tag });
      }
    } catch (_) { /* مجلد غير متاح — تجاهل */ }
  }

  return results;
}

/**
 * جلب طلبات الصداقة عبر GraphQL (يجرّب عدة doc_ids)
 */
async function fetchFriendRequests(api) {
  const DOCS = [
    { doc_id: "4499164963466303", variables: JSON.stringify({ input: { scale: 3 } }) },
    { doc_id: "7090570720997813", variables: JSON.stringify({ count: 30, scale: 1 }) },
  ];

  for (const { doc_id, variables } of DOCS) {
    try {
      const form = {
        av: api.getCurrentUserID(),
        fb_api_caller_class: "RelayModern",
        fb_api_req_friendly_name: "FriendingCometFriendRequestsRootQueryRelayPreloader",
        variables,
        server_timestamps: "true",
        doc_id,
      };

      let raw;
      if (typeof api.httpPost === "function") {
        raw = await api.httpPost("https://www.facebook.com/api/graphql/", form);
      } else if (api._defaultFuncs?.post) {
        const ctx = api._ctx || api.ctx || null;
        raw = await api._defaultFuncs.post(
          "https://www.facebook.com/api/graphql/",
          ctx?.jar,
          form
        );
      } else {
        throw new Error("httpPost unavailable");
      }

      // تنظيف استجابة فيسبوك
      const text = typeof raw === "string"
        ? raw.replace(/^for \(;;\);/, "").trim()
        : null;
      const json = text ? JSON.parse(text) : raw;

      if (json?.errors?.length) continue;

      const edges =
        json?.data?.viewer?.friending_possibilities?.edges ||
        json?.data?.viewer?.friend_requests_v2?.edges ||
        json?.data?.viewer?.friend_requests?.edges || [];

      const unique = new Map();
      for (const edge of edges) {
        const node   = edge?.node ?? edge;
        const userID = String(node?.id || node?.userID || "");
        if (!userID || unique.has(userID)) continue;
        unique.set(userID, {
          userID,
          name: node?.name || node?.full_name || "مجهول",
          mutualCount: node?.mutual_friends?.count ?? 0,
        });
      }

      return [...unique.values()];
    } catch (_) { /* جرّب الـ doc_id التالي */ }
  }

  throw new Error("تعذر جلب طلبات الصداقة — تحقق من الجلسة.");
}

// ─── الأمر الرئيسي ─────────────────────────────────────────────

export default {
  config: {
    name: "acp",
    aliases: ["طلبات"],
    version: "4.0.0",
    role: 2,
    countDown: 10,
    category: "أدوات المطور",
    description: "إدارة طلبات المراسلة والصداقة",
    hidden: true,
    usage: [
      "{pn}acp — عرض طلبات المراسلة",
      "{pn}acp قبول <threadID> — قبول طلب مراسلة",
      "{pn}acp رفض <threadID> — رفض طلب مراسلة",
      "{pn}acp صديق قائمة — طلبات الصداقة",
      "{pn}acp صديق قبول <userID>",
      "{pn}acp صديق رفض <userID>",
    ],
  },

  onStart: async ({ api, event, args, message }) => {
    const { senderID } = event;
    const sub = (args[0] || "").trim().toLowerCase();

    // ── منع التزامن لنفس المستخدم ───────────────────────────────
    if (!global._acpLocks) global._acpLocks = new Set();
    if (global._acpLocks.has(senderID)) {
      return message.reply("⏳ جاري معالجة طلب سابق، انتظر قليلاً...");
    }
    global._acpLocks.add(senderID);
    setTimeout(() => global._acpLocks?.delete(senderID), 5 * 60 * 1000);

    try {

      // ── قبول طلب مراسلة ──────────────────────────────────────
      if (sub === "قبول" || sub === "accept") {
        const gid = (args[1] || "").trim();
        if (!gid) return message.reply("❌ حدد threadID:\nacp قبول <threadID>");
        try {
          await api.handleMessageRequest(gid, true);
          return message.reply(`✅ تم قبول طلب المراسلة\n🆔 ${gid}`);
        } catch (e) {
          return message.reply(`❌ فشل قبول طلب المراسلة:\n${safe(e)}`);
        }
      }

      // ── رفض طلب مراسلة ───────────────────────────────────────
      if (sub === "رفض" || sub === "reject") {
        const gid = (args[1] || "").trim();
        if (!gid) return message.reply("❌ حدد threadID:\nacp رفض <threadID>");
        try {
          await api.handleMessageRequest(gid, false);
          return message.reply(`🚫 تم رفض طلب المراسلة\n🆔 ${gid}`);
        } catch (e) {
          return message.reply(`❌ فشل رفض طلب المراسلة:\n${safe(e)}`);
        }
      }

      // ── طلبات الصداقة ─────────────────────────────────────────
      if (sub === "صديق" || sub === "friend") {
        const action = (args[1] || "").trim().toLowerCase();
        const uid    = (args[2] || "").trim();

        // قائمة طلبات الصداقة
        if (action === "قائمة" || action === "list" || !action) {
          const loading = await message.reply("⏳ جاري جلب طلبات الصداقة...");
          try {
            const reqs = await fetchFriendRequests(api);
            if (!reqs.length) {
              return api.editMessage("ℹ️ لا توجد طلبات صداقة معلقة.", loading.messageID)
                .catch(() => message.reply("ℹ️ لا توجد طلبات صداقة معلقة."));
            }
            const lines = reqs.slice(0, 20).map(
              (r, i) =>
                `${i + 1}. ${r.name}\n` +
                `   🆔 ${r.userID}` +
                (r.mutualCount ? `  •  ${r.mutualCount} مشترك` : "")
            );
            const text =
              `👥 طلبات الصداقة (${reqs.length}):\n` +
              "─".repeat(28) + "\n" + lines.join("\n");
            return api.editMessage(text, loading.messageID)
              .catch(() => message.reply(text));
          } catch (e) {
            return message.reply(`❌ ${safe(e)}`);
          }
        }

        if (!uid || !/^\d{5,20}$/.test(uid)) {
          return message.reply("❌ أدخل UID صحيحاً (رقم 5-20 خانة).");
        }

        const isAccept = action === "قبول" || action === "accept";
        const isReject = action === "رفض"  || action === "reject";

        if (!isAccept && !isReject) {
          return message.reply(
            "❌ الأمر غير معروف.\n" +
            "استخدم: acp صديق قبول/رفض/قائمة"
          );
        }

        try {
          await api.handleFriendRequest(uid, isAccept);
          return message.reply(
            isAccept
              ? `✅ تم قبول طلب الصداقة\n🆔 UID: ${uid}`
              : `🚫 تم رفض طلب الصداقة\n🆔 UID: ${uid}`
          );
        } catch (e) {
          return message.reply(
            `❌ فشل ${isAccept ? "قبول" : "رفض"} طلب الصداقة:\n${safe(e)}`
          );
        }
      }

      // ── عرض جميع طلبات المراسلة (بدون sub-command) ─────────────
      const loading = await message.reply("⏳ جاري جلب الطلبات المعلقة...");
      const threads = await fetchPendingThreads(api);

      if (!threads.length) {
        return api.editMessage("ℹ️ لا توجد طلبات مراسلة معلقة.", loading.messageID)
          .catch(() => message.reply("ℹ️ لا توجد طلبات مراسلة معلقة."));
      }

      const lines = threads.slice(0, 20).map((t, i) => {
        const name  = t.name || t.threadName || "[بدون اسم]";
        const type  = t.isGroup ? "👥 مجموعة" : "👤 شخص";
        const count = t.participantIDs?.length ?? "?";
        return (
          `${i + 1}. ${type} — ${name}\n` +
          `   🆔 ${t.threadID}  •  📁 ${t._folder}` +
          (t.isGroup ? `  •  👥 ${count}` : "")
        );
      });

      const text =
        `📥 طلبات المراسلة المعلقة (${threads.length}):\n` +
        "─".repeat(30) + "\n" + lines.join("\n") +
        "\n\n" +
        "للقبول: acp قبول <threadID>\n" +
        "للرفض:  acp رفض <threadID>";

      return api.editMessage(text, loading.messageID)
        .catch(() => message.reply(text));

    } finally {
      global._acpLocks?.delete(senderID);
    }
  },
};

// ─── Plugin Descriptor ───────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: "xx-commands-admin-acp",
  meta: { category: "command-admin", path: "src/commands/admin/acp.js" },
  setup(_ctx) {},
};
