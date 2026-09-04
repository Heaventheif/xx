"use strict";
import { buildMessageAPI, buildCommandContext } from "./Context.js";
import { HANDLER_KEYS } from "./Loader.js";
import { checkAuth } from "../middlewares/auth.js";
import { checkAndSetCooldown } from "../middlewares/cooldown.js";
import timing from "../utils/timing.js";
export const handleMessage = async (rawApi, event) => {
  const { threadID, senderID, body, messageReply, messageID } = event;
  const hasAttachment = (event.attachments?.length > 0);
  if (!body?.trim() && !hasAttachment) return;
  const api         = global.wrapApiForSafety(rawApi);
  const messageText = body?.trim() ?? "";
  if (!event.isGroup) {
    api.sendMessage(
      "🤖 مرحباً!\n\n" +
      "عذراً، هذا البوت يعمل في المجموعات فقط ولا يدعم المحادثات الخاصة.\n\n" +
      "➕ أضف البوت إلى مجموعتك وابدأ الاستمتاع بالميزات!\n\n" +
      "📩 للتواصل مع المطوّر:\nhttps://www.facebook.com/Zezeerrerree",
      threadID
    );
    return;
  }
  if (messageReply && global.Kagenou.replies?.[messageReply.messageID]) {
    const replyData = global.Kagenou.replies[messageReply.messageID];
    if (!replyData.author || replyData.author === senderID) {
      delete global.Kagenou.replies[messageReply.messageID];
      const cmdForReply = replyData.commandName ? global.commands.get(replyData.commandName) : null;
      const handler = replyData.onReply || replyData.callback ||
        (cmdForReply?.onReply ? (...a) => cmdForReply.onReply(...a) : null);
      if (typeof handler === "function") {
        const replyMessage = buildMessageAPI(api, threadID, undefined);
        Promise.resolve(handler({ api, event, message: replyMessage, Reply: replyData }))
          .catch(e => console.error("[REPLY ERROR]", e.message));
      }
    }
    return;
  }
  const prefixes = (global.config?.Prefix || [""]).map(String);
  let resolvedText = null;
  for (const pfx of prefixes) {
    if (pfx === "" || messageText.startsWith(pfx)) {
      resolvedText = pfx ? messageText.slice(pfx.length).trim() : messageText;
      break;
    }
  }
  let commandName = null;
  let args        = [];
  let command     = null;
  if (resolvedText !== null) {
    const parts = resolvedText.split(/ +/);
    commandName = parts[0]?.toLowerCase();
    args        = parts.slice(1);
    command     = global.commands.get(commandName);
  }
  if (!command) {
    const rawParts = messageText.split(/ +/);
    const rawName  = rawParts[0]?.toLowerCase();
    const rawCmd   = rawName ? global.commands.get(rawName) : null;
    const allowsNoPrefix = rawCmd?.config?.usePrefix === false || rawCmd?.config?.nonPrefix === true;
    if (rawCmd && allowsNoPrefix) {
      commandName = rawName;
      args        = rawParts.slice(1);
      command     = rawCmd;
    }
  }
  if (!command) return;
  if (command.config?.enabled === false) {
    api.sendMessage("⚠️ هذا الأمر معطّل مؤقتاً.", threadID, null, messageID);
    return;
  }
  event.command = commandName;
  const authError = checkAuth(senderID, command);
  if (authError) { api.sendMessage(authError, threadID, null, messageID); return; }
  const cooldownError = checkAndSetCooldown(senderID, commandName, command);
  if (cooldownError) { api.sendMessage(cooldownError, threadID, null, messageID); return; }
  const role = global.getUserRole(senderID);
  const t0 = Date.now();
  (async () => {
    const timer = timing.start(`command:${commandName}`);
    try {
      const ctx = buildCommandContext({ api, event, args, role });
      const fn  = HANDLER_KEYS.map(k => command[k]).find(f => typeof f === "function");
      if (fn) await fn(ctx);
      timer.end();
      global.perfManager?.trackRequest(t0);
    } catch (err) {
      timer.end("(فشل)");
      global.perfManager?.trackError();
      console.error(`[command:${commandName}]`, err.message);
      api.sendMessage("⚠️ حدث خطأ أثناء تنفيذ الأمر — تم إبلاغ المطوّر تلقائياً.", threadID, null, messageID);
    }
  })();
};
export const handleReaction = (api, event) => {
  const msgID = event.messageID;
  if (!msgID) return;
  const entry = global.client.reactionListener[msgID];
  if (!entry) return;
  if (entry.author && event.userID !== entry.author) return;
  global._reactionTimestamps.set(msgID, Date.now());
  Promise.resolve(entry.callback({ api, event }))
    .catch(e => console.error("[REACTION ERR]", e.message));
};
export const handleEvent = async (rawApi, event) => {
  const api       = global.wrapApiForSafety(rawApi);
  const firstWord = event.body?.trim().split(/ +/)[0]?.toLowerCase();
  for (const cmd of global.eventCommands) {
    if (!cmd.onChat) continue;
    const hasAtt = (event.attachments?.length > 0);
    if (!event.messageID || (!event.body && !hasAtt)) continue;
    if (firstWord && global.commands.get(firstWord) === cmd) continue;
    Promise.resolve(cmd.onChat({ api, event, message: buildMessageAPI(api, event.threadID, event.messageID) }))
      .catch(() => {});
  }
};
