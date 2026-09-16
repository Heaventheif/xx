/**
 * poll.js — إنشاء تصويت في المجموعة
 * يستخدم api.createPoll من fca-unofficial
 *
 * الصيغة:
 *   .تصويت <السؤال> | <خيار1> | <خيار2> | ...
 */
export default {
  config: {
    name: "poll",
    aliases: ["تصويت", "استفتاء"],
    version: "1.0.0",
    author: "sunken",
    countDown: 10,
    role: 0,
    category: "إدارة وإشراف",
    description: "إنشاء تصويت في المجموعة",
    usage: [
      "{pn}تصويت <السؤال> | <خيار1> | <خيار2> — إنشاء تصويت",
      "{pn}تصويت ما أفضل وقت للاجتماع؟ | صباح | مساء | ليل",
    ],
  },

  onStart: async ({ api, event, args, message, isGroupAdmin }) => {
    const { threadID } = event;

    if (!isGroupAdmin) {
      return message.reply("❌ هذا الأمر لمشرفي المجموعة فقط!");
    }

    if (typeof api.createPoll !== "function") {
      return message.reply("❌ هذه الميزة غير متاحة في الإصدار الحالي من FCA.");
    }

    const fullText = args.join(" ").trim();
    if (!fullText) {
      return message.reply(
        "❌ الاستخدام:\n" +
        "تصويت <السؤال> | <خيار1> | <خيار2> | ...\n\n" +
        "مثال:\n" +
        "تصويت ما أفضل لون؟ | أحمر | أزرق | أخضر"
      );
    }

    const parts = fullText.split("|").map((p) => p.trim()).filter(Boolean);
    if (parts.length < 3) {
      return message.reply(
        "❌ يجب أن يكون لديك سؤال وخيارَين على الأقل.\n" +
        "افصل بين الأجزاء بـ | (خط عمودي)."
      );
    }

    const question = parts[0];
    const options  = parts.slice(1);

    if (options.length > 10) {
      return message.reply("❌ الحد الأقصى للخيارات هو 10.");
    }

    // api.createPoll يقبل: (title, threadID, options)
    // options إما string[] أو {[name]: boolean} حسب الإصدار
    try {
      await api.createPoll(question, threadID, options);
      return message.reply(
        `✅ تم إنشاء التصويت:\n📊 ${question}\n` +
        options.map((o, i) => `  ${i + 1}. ${o}`).join("\n")
      );
    } catch (err) {
      console.debug("[poll] createPoll failed:", err?.message);
      return message.reply("❌ فشل إنشاء التصويت. تأكد أن البوت مشرف.");
    }
  },
};

// ─── Plugin Descriptor ───────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: "xx-commands-admin-poll",
  meta: { category: "command-admin", path: "src/commands/admin/poll.js" },
  setup(_ctx) {},
};
