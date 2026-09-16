/**
 * broadcast.js — إرسال رسالة جماعية لجميع مجموعات البوت
 * يستخدم api.getThreadList + api.sendMessage
 *
 * ⚠️  يُنصح باستخدامه بحذر لتفادي قيود فيسبوك
 */

// حدّ آمن: رسالة كل ثانيتين، أقصى 50 مجموعة في الدفعة
const DELAY_MS  = 2000;
const MAX_BATCH = 50;

export default {
  config: {
    name: "broadcast",
    aliases: ["بث"],
    version: "1.0.0",
    author: "sunken",
    countDown: 60,
    role: 2,
    category: "إدارة وإشراف",
    description: "إرسال رسالة جماعية لكل المجموعات (للمطورين فقط)",
    hidden: true,
    usage: [
      "{pn}بث <الرسالة> — إرسال رسالة لجميع المجموعات",
      "{pn}بث تجريبي <الرسالة> — معاينة بدون إرسال",
    ],
  },

  onStart: async ({ api, event, args, message }) => {
    const { threadID, senderID } = event;

    const isDryRun =
      args[0]?.toLowerCase() === "تجريبي" ||
      args[0]?.toLowerCase() === "dry";

    const text = (isDryRun ? args.slice(1) : args).join(" ").trim();

    if (!text) {
      return message.reply(
        "❌ أدخل نص الرسالة.\n" +
        "مثال: بث مرحباً بالجميع!"
      );
    }

    // جلب قائمة المجموعات
    let groups = [];
    try {
      const list = await api.getThreadList(MAX_BATCH, null, []);
      groups = list.filter((t) => t.isGroup || t.threadType === "GROUP");
    } catch (err) {
      return message.reply(`❌ فشل جلب قائمة المجموعات: ${err?.message}`);
    }

    if (!groups.length) {
      return message.reply("ℹ️ لم يتم العثور على أي مجموعات.");
    }

    if (isDryRun) {
      return message.reply(
        `🔍 معاينة جماعية:\n` +
        `📤 سيتم الإرسال إلى ${groups.length} مجموعة\n` +
        `💬 النص:\n${text}`
      );
    }

    const confirmMsg = await message.reply(
      `📢 سيتم إرسال رسالة إلى ${groups.length} مجموعة.\n` +
      `⏱️ المدة المقدرة: ~${Math.ceil((groups.length * DELAY_MS) / 60000)} دقيقة\n\n` +
      `الرسالة:\n${text}\n\n` +
      `رد بـ «تأكيد» للمتابعة أو «إلغاء» للإلغاء.`
    );

    // انتظار التأكيد عبر نظام الردود
    global.Kagenou.replies[confirmMsg.messageID] = {
      type: "broadcast_confirm",
      author: String(senderID),
      groups,
      text,
      callback: async (reply) => {
        const body = (reply.body || "").trim().toLowerCase();
        if (body !== "تأكيد" && body !== "confirm") {
          return api.sendMessage("🚫 تم إلغاء البث.", threadID);
        }

        let sent = 0, failed = 0;
        const status = await api.sendMessage(
          `📡 بدأ الإرسال إلى ${groups.length} مجموعة...`,
          threadID
        );

        for (const group of groups) {
          try {
            await api.sendMessage(text, group.threadID);
            sent++;
          } catch (_) {
            failed++;
          }
          await new Promise((r) => setTimeout(r, DELAY_MS));
        }

        api.sendMessage(
          `✅ اكتمل البث!\n📤 ناجح: ${sent}\n❌ فاشل: ${failed}`,
          threadID
        );
      },
    };
  },
};

// ─── Plugin Descriptor ───────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: "xx-commands-admin-broadcast",
  meta: { category: "command-admin", path: "src/commands/admin/broadcast.js" },
  setup(_ctx) {},
};
