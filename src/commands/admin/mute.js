/**
 * mute.js — كتم إشعارات محادثة أو إلغاء الكتم
 * يستخدم api.muteThread من fca-unofficial
 *
 * الأوقات:
 *  -1 = كتم دائم
 *   0 = إلغاء الكتم
 *  ثواني موجبة = كتم مؤقت
 */

const DURATIONS = {
  "دائم": -1,
  "permanent": -1,
  "الغاء": 0,
  "unمute": 0,
  "unmute": 0,
  "ساعة": 3600,
  "1h": 3600,
  "يوم": 86400,
  "1d": 86400,
  "اسبوع": 604800,
  "1w": 604800,
};

export default {
  config: {
    name: "mute",
    aliases: ["كتم"],
    version: "1.0.0",
    author: "sunken",
    countDown: 3,
    role: 0,
    category: "إدارة وإشراف",
    description: "كتم إشعارات محادثة أو إلغاء الكتم",
    usage: [
      "{pn}كتم — كتم دائم للمجموعة الحالية",
      "{pn}كتم ساعة — كتم لمدة ساعة",
      "{pn}كتم يوم — كتم لمدة يوم",
      "{pn}كتم الغاء — إلغاء الكتم",
      "{pn}كتم <ثواني> — كتم لعدد ثواني محدد",
    ],
  },

  onStart: async ({ api, event, args, message, isGroupAdmin }) => {
    const { threadID } = event;

    if (!isGroupAdmin) {
      return message.reply("❌ هذا الأمر لمشرفي المجموعة فقط!");
    }

    if (typeof api.muteThread !== "function") {
      return message.reply("❌ هذه الميزة غير متاحة في الإصدار الحالي من FCA.");
    }

    const input = (args[0] || "دائم").trim().toLowerCase();
    let seconds;

    if (input in DURATIONS) {
      seconds = DURATIONS[input];
    } else if (/^\d+$/.test(input)) {
      seconds = parseInt(input, 10);
    } else {
      return message.reply(
        "❌ قيمة غير صالحة.\n" +
        "الخيارات: دائم | ساعة | يوم | اسبوع | الغاء | <عدد ثواني>"
      );
    }

    const label =
      seconds === -1 ? "إلى الأبد" :
      seconds === 0  ? "(تم إلغاء الكتم)" :
                       `لمدة ${formatDuration(seconds)}`;

    try {
      await api.muteThread(threadID, seconds);
      return message.reply(
        seconds === 0
          ? "🔔 تم إلغاء كتم الإشعارات."
          : `🔕 تم كتم الإشعارات ${label}.`
      );
    } catch (err) {
      console.debug("[mute] muteThread failed:", err?.message);
      return message.reply("❌ فشل كتم الإشعارات.");
    }
  },
};

function formatDuration(s) {
  if (s >= 604800) return `${Math.round(s / 604800)} أسبوع`;
  if (s >= 86400)  return `${Math.round(s / 86400)} يوم`;
  if (s >= 3600)   return `${Math.round(s / 3600)} ساعة`;
  if (s >= 60)     return `${Math.round(s / 60)} دقيقة`;
  return `${s} ثانية`;
}

// ─── Plugin Descriptor ───────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: "xx-commands-admin-mute",
  meta: { category: "command-admin", path: "src/commands/admin/mute.js" },
  setup(_ctx) {},
};
