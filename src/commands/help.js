"use strict";

export const config = {
  name:        "help",
  aliases:     ["مساعدة", "اوامر"],
  description: "عرض قائمة الأوامر المتاحة",
  usage:       "help [اسم الأمر]",
  cooldown:    5,
};

export async function run({ api, event, args }) {
  const { threadID, messageID } = event;

  if (args[0]) {
    // مساعدة عن أمر معين
    const cmdName = args[0].toLowerCase();
    const cmd = global.commands.get(cmdName);
    if (!cmd) {
      return api.sendMessage(`❌ الأمر "${cmdName}" غير موجود.`, threadID, messageID);
    }
    const c = cmd.config || cmd.mod?.config || {};
    const msg =
      `📌 ${c.name || cmdName}\n` +
      `📝 ${c.description || "لا يوجد وصف"}\n` +
      (c.usage    ? `💡 الاستخدام: ${c.usage}\n`  : "") +
      (c.cooldown ? `⏱️ التأخير: ${c.cooldown}ث\n` : "");
    return api.sendMessage(msg, threadID, messageID);
  }

  // قائمة كاملة
  const prefix = (global.config?.Prefix?.[0]) || ".";
  const cmds   = [...global.commands.values()];
  if (cmds.length === 0) {
    return api.sendMessage("⚠️ لا توجد أوامر محملة حالياً.", threadID, messageID);
  }

  const list = cmds.map((c) => {
    const cfg = c.config || c.mod?.config || {};
    return `▸ ${prefix}${cfg.name || "؟"} — ${cfg.description || ""}`;
  }).join("\n");

  const msg =
    `🤖 ${global.config?.botName || "Bot"} — الأوامر المتاحة\n` +
    `${"─".repeat(30)}\n` +
    list + "\n" +
    `${"─".repeat(30)}\n` +
    `📦 المجموع: ${cmds.length} أمر`;

  api.sendMessage(msg, threadID, messageID);
}
