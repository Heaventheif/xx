"use strict";
import path from "path";
import crypto from "crypto";
import express from "express";
import chalk from "chalk";
import { buildCommandContext } from "../../core/Context.js";
import { HANDLER_KEYS } from "../../core/Loader.js";
import { checkAuth } from "../../middlewares/auth.js";
import { checkAndSetCooldown } from "../../middlewares/cooldown.js";
import * as dashboardUsers from "../dashboard/users.js";
const PUBLIC_DIR = path.join(import.meta.dir, "public");
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; 
const sessions = new Map(); 
function makeSessionId() {
  return crypto.randomBytes(32).toString("hex");
}
function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}
function isRequestSecure(req) {
  return req.secure || req.headers["x-forwarded-proto"] === "https";
}
function setSidCookie(req, res, sid, maxAgeMs) {
  const attrs = [
    `pgsid=${encodeURIComponent(sid)}`,
    "Path=/playground",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (isRequestSecure(req)) attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}
function clearSidCookie(req, res) {
  const attrs = ["pgsid=", "Path=/playground", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (isRequestSecure(req)) attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}
function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [sid, exp] of sessions.entries()) {
    if (exp <= now) sessions.delete(sid);
  }
}
setInterval(cleanupExpiredSessions, 30 * 60 * 1000);
function buildMockApi({ botID, outbox }) {
  let nextMsgId = 1;
  function captureSend(body, threadID, callback, messageID) {
    const entry = {
      type: "text",
      threadID: String(threadID),
      body:
        typeof body === "string" ? body
        : body?.body !== undefined ? body.body
        : body,
      attachment: body?.attachment ? "[مرفق/ملف — غير مدعوم في المعاينة]" : undefined,
      at: Date.now(),
    };
    outbox.push(entry);
    const info = { messageID: `pg_${Date.now()}_${nextMsgId++}`, threadID: String(threadID) };
    if (typeof callback === "function") callback(null, info);
    return Promise.resolve(info);
  }
  const base = {
    sendMessage: captureSend,
    sendTypingIndicator: () => Promise.resolve(),
    markAsRead: () => Promise.resolve(),
    setMessageReaction: () => Promise.resolve(),
    unsendMessage: (msgID) => {
      outbox.push({ type: "system", body: `↩️ (unsend) ${msgID}`, at: Date.now() });
      return Promise.resolve();
    },
    getCurrentUserID: () => botID,
    getUserInfo: (ids, cb) => {
      const list = Array.isArray(ids) ? ids : [ids];
      const result = {};
      for (const id of list) result[id] = { name: `مستخدم ${id}`, id };
      if (typeof cb === "function") cb(null, result);
      return Promise.resolve(result);
    },
    getThreadInfo: (threadID, cb) => {
      const info = {
        threadID: String(threadID),
        threadName: "بيئة اختبار (Playground)",
        isGroup: true,
        participantIDs: [botID],
      };
      if (typeof cb === "function") cb(null, info);
      return Promise.resolve(info);
    },
    getThreadList: (limit, cursor, tags, cb) => {
      if (typeof cb === "function") cb(null, []);
      return Promise.resolve([]);
    },
  };
  return new Proxy(base, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop !== "string") return undefined;
      return (...callArgs) => {
        const cb = callArgs.find((a) => typeof a === "function");
        if (cb) { cb(null, {}); return; }
        return Promise.resolve({});
      };
    },
  });
}
async function runCommand({ text, threadID, senderID, isGroup }) {
  const outbox = [];
  const botID = "PLAYGROUND_BOT";
  const rawApi = buildMockApi({ botID, outbox });
  const api = global.wrapApiForSafety ? global.wrapApiForSafety(rawApi) : rawApi;
  const messageID = `pg_in_${Date.now()}`;
  const event = {
    threadID: String(threadID),
    senderID: String(senderID),
    body: text,
    messageID,
    isGroup: !!isGroup,
    attachments: [],
  };
  if (!isGroup) {
    outbox.push({
      type: "text",
      body:
        "🤖 مرحباً!\n\nعذراً، هذا البوت يعمل في المجموعات فقط ولا يدعم المحادثات الخاصة.\n\n" +
        "➕ أضف البوت إلى مجموعتك وابدأ الاستمتاع بالميزات!",
    });
    return { outbox, matchedCommand: null };
  }
  const prefixes = (global.config?.Prefix || [""]).map(String);
  let resolvedText = null;
  for (const pfx of prefixes) {
    if (pfx === "" || text.startsWith(pfx)) {
      resolvedText = pfx ? text.slice(pfx.length).trim() : text;
      break;
    }
  }
  let commandName = null;
  let args = [];
  let command = null;
  if (resolvedText !== null) {
    const parts = resolvedText.split(/ +/);
    commandName = parts[0]?.toLowerCase();
    args = parts.slice(1);
    command = global.commands?.get(commandName);
  }
  if (!command) {
    const rawParts = text.split(/ +/);
    const rawName = rawParts[0]?.toLowerCase();
    const rawCmd = rawName ? global.commands?.get(rawName) : null;
    const allowsNoPrefix = rawCmd?.config?.usePrefix === false || rawCmd?.config?.nonPrefix === true;
    if (rawCmd && allowsNoPrefix) {
      commandName = rawName;
      args = rawParts.slice(1);
      command = rawCmd;
    }
  }
  if (!command) {
    return { outbox: [], matchedCommand: null, noMatch: true };
  }
  event.command = commandName;
  const authError = checkAuth(senderID, command);
  if (authError) { outbox.push({ type: "text", body: authError }); return { outbox, matchedCommand: commandName }; }
  const cooldownError = checkAndSetCooldown(senderID, commandName, command);
  if (cooldownError) { outbox.push({ type: "text", body: cooldownError }); return { outbox, matchedCommand: commandName }; }
  const role = global.getUserRole ? global.getUserRole(senderID) : 0;
  try {
    const ctx = buildCommandContext({ api, event, args, role });
    const fn = HANDLER_KEYS.map((k) => command[k]).find((f) => typeof f === "function");
    if (fn) await fn(ctx);
  } catch (err) {
    console.error(`[playground:${commandName}]`, err.message);
    outbox.push({ type: "text", body: `⚠️ حدث خطأ أثناء تنفيذ الأمر: ${String(err.message || err).slice(0, 300)}` });
  }
  return { outbox, matchedCommand: commandName };
}
function registerPlayground(app) {
  const router = express.Router();
  router.use(express.json({ limit: "1mb" }));
  function requireAuth(req, res, next) {
    const cookies = parseCookies(req);
    const sid = cookies.pgsid;
    const exp = sid ? sessions.get(sid) : null;
    if (!exp || exp <= Date.now()) {
      return res.status(401).json({ error: "unauthorized" });
    }
    sessions.set(sid, Date.now() + SESSION_TTL_MS);
    next();
  }
  router.post("/api/login", async (req, res) => {
    const { username, password } = req.body || {};
    const result = await dashboardUsers.verifyUser(username, password);
    if (!result.ok) {
      return res.status(401).json({ error: result.error });
    }
    const sid = makeSessionId();
    sessions.set(sid, Date.now() + SESSION_TTL_MS);
    setSidCookie(req, res, sid, SESSION_TTL_MS);
    res.json({ ok: true });
  });
  router.post("/api/logout", (req, res) => {
    const cookies = parseCookies(req);
    if (cookies.pgsid) sessions.delete(cookies.pgsid);
    clearSidCookie(req, res);
    res.json({ ok: true });
  });
  router.get("/api/me", requireAuth, (_req, res) => res.json({ ok: true }));
  router.get("/api/config", requireAuth, (_req, res) => {
    res.json({
      prefixes: global.config?.Prefix || [],
      botName: global.config?.botName || "Bot",
      commandsLoaded: global.commands?.size || 0,
    });
  });
  router.post("/api/send", requireAuth, async (req, res) => {
    const { text, threadID, senderID, isGroup } = req.body || {};
    const msg = String(text ?? "").trim();
    if (!msg) return res.status(400).json({ error: "الرسالة فارغة" });
    try {
      const result = await runCommand({
        text: msg,
        threadID: threadID ? String(threadID) : "playground-thread",
        senderID: senderID ? String(senderID) : "playground-user",
        isGroup: isGroup !== false,
      });
      res.json(result);
    } catch (e) {
      console.error("[PLAYGROUND/send]", e.message);
      res.status(500).json({ error: e.message?.slice(0, 300) || "خطأ غير معروف" });
    }
  });
  app.use("/playground", router);
  app.use("/playground", express.static(PUBLIC_DIR));
  console.log(chalk.green("[PLAYGROUND] ✅ بيئة اختبار الأوامر متاحة على /playground"));
}
export { registerPlayground };
