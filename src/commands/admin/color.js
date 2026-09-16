/**
 * color.js — تغيير لون المجموعة
 * يستخدم api.setThreadColor من fca-unofficial
 * الألوان المتاحة موجودة في api.threadColors
 */

// ألوان مدمجة للاختصارات العربية
const COLOR_MAP = {
  "احمر":    "#e68585",
  "أحمر":    "#e68585",
  "red":     "#e68585",
  "وردي":   "#e5a2ac",
  "pink":    "#e5a2ac",
  "برتقالي":"#f7c065",
  "orange":  "#f7c065",
  "اصفر":   "#ffd600",
  "أصفر":   "#ffd600",
  "yellow":  "#ffd600",
  "اخضر":   "#00bcd4",
  "أخضر":   "#00bcd4",
  "green":   "#00bcd4",
  "ازرق":   "#0084ff",
  "أزرق":   "#0084ff",
  "blue":    "#0084ff",
  "بنفسجي": "#9c8fe8",
  "purple":  "#9c8fe8",
  "رمادي":  "#b0b0b0",
  "gray":    "#b0b0b0",
  "اسود":   "#000000",
  "أسود":   "#000000",
  "black":   "#000000",
  "افتراضي":"#0084ff",
  "default": "#0084ff",
};

export default {
  config: {
    name: "color",
    aliases: ["لون", "اللون"],
    version: "1.0.0",
    author: "sunken",
    countDown: 3,
    role: 0,
    category: "إدارة وإشراف",
    description: "تغيير لون المجموعة",
    usage: [
      "{pn}لون أحمر — تغيير اللون باسم عربي",
      "{pn}لون blue — تغيير اللون باسم إنجليزي",
      "{pn}لون #ff5733 — تغيير اللون بكود HEX",
      "{pn}لون — عرض الألوان المتاحة",
    ],
  },

  onStart: async ({ api, event, args, message, isGroupAdmin }) => {
    const { threadID } = event;

    if (!isGroupAdmin) {
      return message.reply("❌ هذا الأمر لمشرفي المجموعة فقط!");
    }

    if (typeof api.setThreadColor !== "function") {
      return message.reply("❌ هذه الميزة غير متاحة في الإصدار الحالي من FCA.");
    }

    const input = args.join(" ").trim().toLowerCase();

    if (!input) {
      const list = Object.keys(COLOR_MAP)
        .filter((k) => !/[a-z]/.test(k)) // عرض الأسماء العربية فقط
        .join(" | ");
      return message.reply(
        "🎨 الألوان المتاحة:\n" + list +
        "\n\nأو أدخل كود HEX مباشرة مثل: #ff5733"
      );
    }

    let colorHex =
      COLOR_MAP[input] ||
      COLOR_MAP[args[0]] ||
      (args[0]?.startsWith("#") ? args[0] : null);

    if (!colorHex) {
      // جرب البحث في api.threadColors إن كانت متوفرة
      try {
        const available = await api.getThreadColors?.();
        if (available) {
          const found = Object.entries(available).find(
            ([name]) => name.toLowerCase() === input
          );
          if (found) colorHex = found[1];
        }
      } catch (_) {}
    }

    if (!colorHex) {
      return message.reply(
        `❌ اللون "${input}" غير معروف.\n` +
        "استخدم: لون بدون كلمات لعرض الألوان المتاحة."
      );
    }

    try {
      await api.setThreadColor(colorHex, threadID);
      return message.reply(`✅ تم تغيير لون المجموعة إلى ${colorHex} 🎨`);
    } catch (err) {
      console.debug("[color] setThreadColor failed:", err?.message);
      return message.reply("❌ فشل تغيير اللون. تأكد أن البوت مشرف.");
    }
  },
};

// ─── Plugin Descriptor ───────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: "xx-commands-admin-color",
  meta: { category: "command-admin", path: "src/commands/admin/color.js" },
  setup(_ctx) {},
};
