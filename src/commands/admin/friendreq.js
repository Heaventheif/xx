/**
 * friendreq.js — إدارة طلبات الصداقة
 * يستخدم api.handleFriendRequest من fca-unofficial
 *
 * الأوامر الفرعية:
 *   قائمة / list         — عرض الطلبات المعلقة (إن توفر api.getFriendRequests)
 *   قبول / accept <UID>  — قبول طلب صداقة
 *   رفض  / decline <UID> — رفض طلب صداقة
 */
export default {
  config: {
    name: "friendreq",
    aliases: ["صداقة", "طلب_صداقة"],
    version: "1.0.0",
    author: "sunken",
    countDown: 5,
    role: 2,
    category: "إدارة وإشراف",
    description: "إدارة طلبات الصداقة للبوت (قبول / رفض / عرض)",
    usage: [
      "{pn}صداقة قائمة — عرض طلبات الصداقة المعلقة",
      "{pn}صداقة قبول <UID> — قبول طلب صداقة",
      "{pn}صداقة رفض <UID> — رفض طلب صداقة",
    ],
  },

  onStart: async ({ api, event, args, message }) => {
    const sub = (args[0] || "").trim().toLowerCase();
    const uid = (args[1] || "").trim();

    // ── قائمة الطلبات المعلقة ────────────────────────────────────
    if (sub === "قائمة" || sub === "list") {
      // نحاول api.getFriendsList إن كانت متوفرة
      if (typeof api.getFriendsList !== "function") {
        return message.reply(
          "ℹ️ عرض الطلبات غير متاح مباشرةً في هذه النسخة.\n" +
          "استخدم: صداقة قبول <UID> أو صداقة رفض <UID>"
        );
      }
      try {
        const friends = await api.getFriendsList();
        if (!friends?.length) return message.reply("ℹ️ لا توجد طلبات صداقة معلقة حالياً.");
        const lines = friends.slice(0, 20).map(
          (f, i) => `${i + 1}. ${f.fullName || f.name || "مجهول"} — ${f.userID}`
        );
        return message.reply(`📋 قائمة الأصدقاء (أول 20):\n${lines.join("\n")}`);
      } catch (err) {
        return message.reply(`❌ فشل جلب القائمة: ${err?.message || err}`);
      }
    }

    // ── قبول / رفض ──────────────────────────────────────────────
    const isAccept  = sub === "قبول"  || sub === "accept";
    const isDecline = sub === "رفض"   || sub === "decline" || sub === "رفض";

    if (!isAccept && !isDecline) {
      return message.reply(
        "❌ أمر غير معروف.\n\n" +
        "الاستخدام:\n" +
        "صداقة قائمة\n" +
        "صداقة قبول <UID>\n" +
        "صداقة رفض <UID>"
      );
    }

    if (!uid || !/^\d{5,20}$/.test(uid)) {
      return message.reply("❌ أدخل UID صحيحاً (رقم من 5 إلى 20 خانة).");
    }

    if (typeof api.handleFriendRequest !== "function") {
      return message.reply("❌ هذه الميزة غير متاحة في الإصدار الحالي من FCA.");
    }

    try {
      await api.handleFriendRequest(uid, isAccept);
      return message.reply(
        isAccept
          ? `✅ تم قبول طلب الصداقة من ${uid}.`
          : `🚫 تم رفض طلب الصداقة من ${uid}.`
      );
    } catch (err) {
      const msg = err?.message || String(err);
      console.debug("[friendreq] handleFriendRequest failed:", msg);
      return message.reply(`❌ فشل ${isAccept ? "قبول" : "رفض"} الطلب:\n${msg}`);
    }
  },
};

// ─── Plugin Descriptor ───────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: "xx-commands-admin-friendreq",
  meta: { category: "command-admin", path: "src/commands/admin/friendreq.js" },
  setup(_ctx) {},
};
