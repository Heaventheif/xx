/**
 * members.js — عرض أعضاء المجموعة
 * يجمع بين api.getThreadInfo وapi.getUserInfo
 */
export default {
  config: {
    name: "members",
    aliases: ["عضو"],
    version: "1.0.0",
    author: "sunken",
    countDown: 10,
    role: 0,
    category: "إدارة وإشراف",
    description: "عرض قائمة أعضاء المجموعة مع تمييز المشرفين",
    usage: [
      "{pn}أعضاء — عرض جميع أعضاء المجموعة",
      "{pn}أعضاء <رقم_صفحة> — التنقل بين الصفحات",
    ],
  },

  onStart: async ({ api, event, args, message }) => {
    const { threadID } = event;
    const PAGE_SIZE = 20;
    const page = Math.max(1, parseInt(args[0]) || 1);

    try {
      const info = await api.getThreadInfo(threadID);
      if (!info) return message.reply("❌ فشل جلب معلومات المجموعة.");

      const participantIDs = info.participantIDs || [];
      if (!participantIDs.length) {
        return message.reply("ℹ️ لا يوجد أعضاء في هذه المحادثة.");
      }

      // مجموعة معرفات المشرفين
      const adminSet = new Set(
        (info.adminIDs || []).map((a) =>
          String(typeof a === "object" ? a.id : a)
        )
      );

      const botID = String(api.getCurrentUserID());

      // جلب أسماء الأعضاء (دفعات)
      let names = {};
      try {
        const slice = participantIDs.slice(0, 100); // حد API
        names = await api.getUserInfo(slice) || {};
      } catch (_) {}

      const totalPages = Math.ceil(participantIDs.length / PAGE_SIZE);
      const currentPage = Math.min(page, totalPages);
      const start = (currentPage - 1) * PAGE_SIZE;
      const slice = participantIDs.slice(start, start + PAGE_SIZE);

      const lines = slice.map((uid, i) => {
        const strUID = String(uid);
        const uinfo  = names[strUID];
        const name   = uinfo?.name || uinfo?.fullName || `UID: ${strUID}`;
        const isAdmin = adminSet.has(strUID);
        const isBot   = strUID === botID;
        const badge   = isBot ? " 🤖" : isAdmin ? " 🎖️" : "";
        return `${start + i + 1}. ${name}${badge}`;
      });

      const header =
        `👥 أعضاء المجموعة (${participantIDs.length} عضو)\n` +
        `صفحة ${currentPage}/${totalPages}\n` +
        "─".repeat(28);

      const footer =
        totalPages > 1
          ? `\nاكتب «أعضاء ${currentPage + 1}» للصفحة التالية.`
          : "";

      return message.reply(`${header}\n${lines.join("\n")}${footer}`);
    } catch (err) {
      console.debug("[members] failed:", err?.message);
      return message.reply("❌ فشل جلب قائمة الأعضاء.");
    }
  },
};

// ─── Plugin Descriptor ───────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: "xx-commands-admin-members",
  meta: { category: "command-admin", path: "src/commands/admin/members.js" },
  setup(_ctx) {},
};
