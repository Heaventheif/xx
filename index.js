"use strict";
process.env.TZ = 'Europe/Berlin';

const FB_EMAIL    = process.env.FB_EMAIL    || "";
const FB_PASSWORD = process.env.FB_PASSWORD || "";

// Sync to FCA_EMAIL / FCA_PASSWORD so fca-main can auto-resolve credentials
// via resolveCredentialsFromEnv() without requiring a separate env entry.
if (FB_EMAIL)    process.env.FCA_EMAIL    = FB_EMAIL;
if (FB_PASSWORD) process.env.FCA_PASSWORD = FB_PASSWORD;

import { checkEnv } from "./utils/envCheck";

// Rate-limited to once per 5s to avoid crash-flood spam
global.__critLogLast = 0;
process.on("uncaughtException", (err) => {
  if (err.code === "EPIPE" || err.code === "ECONNRESET" || err.code === "ETIMEDOUT") return;
  const now = Date.now();
  if (now - global.__critLogLast > 5000) {
    global.__critLogLast = now;
    console.error("[uncaughtException]", err?.stack || err?.message || err);
  }
});
process.on("unhandledRejection", (reason) => {
  const msg = reason?.message || String(reason);
  if (msg.includes("EPIPE") || msg.includes("ECONNRESET") || msg.includes("ETIMEDOUT")) return;
  console.error("[unhandledRejection]", msg);
});

// ── Reaction listener ────────────────────────────────────────────────────────
const _reactionTimestamps = new Map();
const _reactionListenerRaw = {};
const reactionListenerProxy = new Proxy(_reactionListenerRaw, {
  set(target, prop, value) {
    _reactionTimestamps.set(prop, Date.now());
    target[prop] = value;
    return true;
  },
  deleteProperty(target, prop) {
    _reactionTimestamps.delete(prop);
    delete target[prop];
    return true;
  }
});

// ── Globals ──────────────────────────────────────────────────────────────────
global.client              = { reactionListener: reactionListenerProxy };
global._reactionTimestamps = _reactionTimestamps;
global.Kagenou             = { replies: {} };
global.config              = { admins: [], moderators: [], developers: [], vips: [], Prefix: ["."], botName: "Sunken Bot" };
global.globalData          = new Map();
global.usersData           = new Map();
global.userCooldowns       = new Map();
global.commands            = new Map();
global.eventCommands       = [];
global.scheduledCommands   = [];   // Commands that define onSchedule (daily tick)
global.appState            = {};       // kept for backward-compat (first account)
global.botApi              = null;     // kept for backward-compat (first account)
global.botApis             = [];       // array of ALL active bot API instances
global.scheduler           = null;    // first bot's scheduler (used by commands)
global.perfManager         = null;    // first bot's perf manager
global.sessionGuard        = null;    // first bot's session guard

import fs from "fs-extra";
import path from "path";
import { pathToFileURL } from "url";
import { buildMessageAPI, buildCommandContext } from "./utils/context";
import timing from "./utils/timing";
import botEnhancer from "./utils/bot-enhancer";
import cache from "./utils/cache";
import "./utils/safeSend";
import { buildRoleSets } from "./utils/roles";
import { buildBanSets } from "./utils/banList";
import { cleanupOrphanTempFiles } from "./utils/tempCleanup";
import { startWebServer } from "./server/webServer";

// ── fca-unofficial: core + performance + safety + nexus ─────────────────────
import * as fcaModule from "fca-unofficial";
// loginAsync تُرجع ctx الكامل (jar + fb_dtsg + api)
// login تُرجع api فقط — كلتاهما مُصدَّرتان مباشرةً من fca-unofficial
const loginAsync = fcaModule.loginAsync;
const login      = fcaModule.login;

// makeDefaults: نبني shim متوافق مع واجهة makeDefaults الداخلية
// CookieRefresher يستدعي: defaultFuncs.get(url, jar, qs)
// نحن لا نملك الـ jar الداخلي (ctxMain.jar) خارج loginAsync
// لذا نبني wrapper يستخدم ctx._request الموجود مباشرةً على ctx
let _makeDefaultsFn = null;
async function getMakeDefaults() {
  if (_makeDefaultsFn) return _makeDefaultsFn;
  try {
    const mod = await import("fca-unofficial/lib/utils/request/defaults.js");
    _makeDefaultsFn = mod.makeDefaults ?? mod.default?.makeDefaults ?? null;
  } catch {
    _makeDefaultsFn = null;
  }
  return _makeDefaultsFn;
}

// بناء _defaultFuncs متوافق من ctx._request (بدون حاجة لـ jar خارجي)
// يُغلّف ctx._request بواجهة تطابق توقيع makeDefaults:
//   get(url, jar, qs)  → ctx._request.get(url, { params: qs })
//   post(url, jar, form) → ctx._request.post(url, form)
function buildDefaultFuncsFromRequest(ctxRequest) {
  if (!ctxRequest) return null;
  return {
    get:         (url, _jar, qs)       => ctxRequest.get(url, { params: qs }),
    post:        (url, _jar, form)     => ctxRequest.post(url, form),
    postFormData:(url, _jar, form, qs) => ctxRequest.postFormData(url, form, { params: qs }),
  };
}

const {
  attachNexusMethods,
  getGlobalPerformanceManager,
  createCookieRefresher,
  createSessionGuard,
  attachThreadInfoRealtimeSync,
  createSchedulerDomain,
  defaultConfig: fcaDefaultConfig,
} = fcaModule;

console.log(
  "[FCA] apiServer:", JSON.stringify(fcaDefaultConfig?.apiServer ?? ""),
  "| autoLogin:", fcaDefaultConfig?.autoLogin
);

import chalk from "chalk";

try { await import("dotenv/config"); } catch (_) {}

checkEnv();

global.log = {
  info:    msg => console.log(chalk.blue("[INFO]"),    msg),
  warn:    msg => console.log(chalk.yellow("[WARN]"),  msg),
  error:   msg => console.log(chalk.red("[ERROR]"),    msg),
  success: msg => console.log(chalk.green("[SUCCESS]"), msg),
};

try {
  const cfg = JSON.parse(fs.readFileSync(path.join(import.meta.dir, "config.json"), "utf8"));
  global.config = { ...global.config, ...cfg, Prefix: cfg.Prefix || ["."] };
  buildRoleSets();
  buildBanSets();
} catch { console.warn("[WARN] Using default config"); }

// ── Command loader ───────────────────────────────────────────────────────────
const HANDLER_KEYS = ["onStart", "run", "execute", "main", "handle", "onMessage", "init", "call"];

function resolveModule(raw, file) {
  const mod = (raw.default && typeof raw.default === "object") ? raw.default
    : (typeof raw.default === "function")                       ? raw.default
    : raw;

  if (typeof mod === "function") {
    const name = path.basename(file, ".js").toLowerCase();
    return { name, mod: { run: mod }, handler: mod, onChat: null, onReply: null };
  }

  const handlerKey  = HANDLER_KEYS.find(k => typeof mod[k] === "function");
  const namedHandler = !handlerKey ? HANDLER_KEYS.find(k => typeof raw[k] === "function") : null;

  if (!handlerKey && !namedHandler && !mod.onChat && !raw.onChat) return null;

  const resolved  = namedHandler ? { ...raw, ...mod } : mod;
  const rawName   = resolved.config?.name || path.basename(file, ".js");
  const name      = String(rawName).toLowerCase();

  return {
    name,
    mod:        resolved,
    handler:    resolved[handlerKey || namedHandler] || null,
    onChat:     resolved.onChat     || raw.onChat     || null,
    onReply:    resolved.onReply    || raw.onReply    || null,
    onSchedule: resolved.onSchedule || raw.onSchedule || null,
  };
}

const loadCommands = async () => {
  const dir = path.join(import.meta.dir, "cmds");
  if (!fs.existsSync(dir)) return [];
  global.commands.clear();
  global.eventCommands     = [];
  global.scheduledCommands = [];

  const fileErrors = [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".js"));
  const stamp  = Date.now();
  console.log(chalk.blue(`[CMDS] 📦 بدء تحميل ${files.length} ملف (متوازي)...`));

  const results = await Promise.allSettled(
    files.map(file => import(`${pathToFileURL(path.join(dir, file)).href}?update=${stamp}`))
  );

  for (let i = 0; i < files.length; i++) {
    const file   = files[i];
    const result = results[i];

    if (result.status === "rejected") {
      console.warn(chalk.yellow(`[CMDS]   ↳ ${file} ❌ ${result.reason?.message}`));
      fileErrors.push({ file, message: result.reason?.message });
      continue;
    }

    try {
      const resolved = resolveModule(result.value, file);
      if (!resolved) { console.log(chalk.gray(`[CMDS]   ↳ ${file} ⏭️`)); continue; }

      const { name, mod, onChat, onReply, onSchedule } = resolved;
      global.commands.set(name, mod);
      (mod.config?.aliases || []).forEach(a => global.commands.set(String(a).toLowerCase(), mod));
      if (onReply)    { if (!mod.onReply)    mod.onReply    = onReply;    }
      if (onSchedule) { if (!mod.onSchedule) mod.onSchedule = onSchedule; global.scheduledCommands.push(mod); }
      if (onChat)     { if (!mod.onChat)     mod.onChat     = onChat;     global.eventCommands.push(mod); }

      console.log(chalk.gray(`[CMDS]   ↳ ${file} ✅ (${name})`));
    } catch (err) {
      console.warn(chalk.yellow(`[CMDS]   ↳ ${file} ❌ ${err.message}`));
      fileErrors.push({ file, message: err.message });
    }
  }
  console.log(chalk.blue(`[INFO] تم تحميل ${global.commands.size} أمر من أصل ${files.length} ملف`));
  return fileErrors;
};
global.reloadCommands = loadCommands;

// ── Multi-account: save appstate per-bot to its own file ─────────────────────
// Bot 1 → appstate.json | Bot 2 → appstate2.json | Bot 3 → appstate3.json ...
// Atomic write: save to .tmp then rename so a crash mid-write never
// leaves a corrupt appstate file (matches fca-2026 FacebookSafety pattern).
function saveAppStateForBot(state, botIndex) {
  const suffix   = botIndex === 1 ? "" : String(botIndex);
  const filePath = path.join(import.meta.dir, `appstate${suffix}.json`);
  const tmpPath  = filePath + ".tmp";
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf8");
    try { fs.chmodSync(tmpPath, 0o600); } catch (_) {}
    fs.renameSync(tmpPath, filePath);
    console.log(chalk.green(`[SESSION] 💾 Bot-${botIndex}: appstate${suffix}.json محفوظ`));
  } catch (err) {
    // Clean up orphan .tmp if rename failed
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
    console.error(chalk.red(`[SESSION] ❌ Bot-${botIndex}: فشل حفظ AppState:`, err.message));
  }
}

// ── Multi-account: load all available appstates ──────────────────────────────
// Supports files: appstate.json, appstate2.json, appstate3.json, ...
// Or env vars:    APPSTATE / APPSTATE_1, APPSTATE_2, APPSTATE_3, ...
function loadAllAppStates() {
  const accounts = [];

  // --- 1. Try numbered files first (appstate.json = bot 1) ---
  for (let i = 1; i <= 20; i++) {
    const suffix = i === 1 ? "" : String(i);
    const filePath = path.join(import.meta.dir, `appstate${suffix}.json`);
    if (fs.existsSync(filePath)) {
      try {
        const state = JSON.parse(fs.readFileSync(filePath, "utf8"));
        accounts.push({ state, filePath, index: i, source: `appstate${suffix}.json` });
        console.log(chalk.cyan(`[MULTI] ✅ وجد appstate${suffix}.json → Bot-${i}`));
      } catch (e) {
        console.warn(chalk.yellow(`[MULTI] ⚠️ appstate${suffix}.json تالف: ${e.message}`));
      }
    }
  }

  // --- 2. Env vars (only if no files found at all) ---
  if (accounts.length === 0) {
    // Support: APPSTATE, APPSTATE_BOT1, APPSTATE_1
    const firstEnvKeys = ["APPSTATE", "APPSTATE_BOT1", "APPSTATE_1"];
    for (const key of firstEnvKeys) {
      if (process.env[key]) {
        try {
          accounts.push({ state: JSON.parse(process.env[key]), filePath: null, index: 1, source: key });
          console.log(chalk.cyan(`[MULTI] ✅ وجد env ${key} → Bot-1`));
          break;
        } catch { console.warn(chalk.yellow(`[MULTI] ⚠️ ${key} تالف`)); }
      }
    }
    // APPSTATE_2, APPSTATE_3, ...
    for (let i = 2; i <= 20; i++) {
      const key = `APPSTATE_${i}`;
      if (process.env[key]) {
        try {
          accounts.push({ state: JSON.parse(process.env[key]), filePath: null, index: i, source: key });
          console.log(chalk.cyan(`[MULTI] ✅ وجد env ${key} → Bot-${i}`));
        } catch { console.warn(chalk.yellow(`[MULTI] ⚠️ ${key} تالف`)); }
      }
    }
  }

  return accounts;
}

// ── Message handler ──────────────────────────────────────────────────────────
const handleMessage = async (rawApi, event) => {
  const { threadID, senderID, body, messageReply, messageID } = event;
  const hasAttachment = (event.attachments?.length > 0);
  if (!body?.trim() && !hasAttachment) return;

  const api         = global.wrapApiForSafety(rawApi);
  const messageText = body.trim();

  // ── DM guard — bot only works in group threads ────────────────────────────
  // event.isGroup is false for private (1-to-1) conversations.
  // Notify the sender on every message so they know to use groups instead.
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

  // ── Reply handler ──────────────────────────────────────────────────────────
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

  // ── Prefix resolution ──────────────────────────────────────────────────────
  const prefixes = (global.config?.Prefix || [""]).map(String);
  let resolvedText = null;
  for (const pfx of prefixes) {
    if (pfx === "" || messageText.startsWith(pfx)) {
      resolvedText = pfx ? messageText.slice(pfx.length).trim() : messageText;
      break;
    }
  }
  if (resolvedText === null) return;

  const parts       = resolvedText.split(/ +/);
  const commandName = parts[0]?.toLowerCase();
  const args        = parts.slice(1);
  const command     = global.commands.get(commandName);
  if (!command) return;

  const role    = global.getUserRole(senderID);
  const reqRole = command.config?.role ?? 0;
  if (role < reqRole) {
    api.sendMessage("⚠️ هذا الأمر للمشرفين فقط", threadID, null, messageID);
    return;
  }

  const cdMsg = global.checkCooldown(senderID, commandName);
  if (cdMsg) { api.sendMessage(cdMsg, threadID, null, messageID); return; }
  global.setCooldown(senderID, commandName, command.config?.countDown ?? 3);

  // ── Track via PerformanceManager ───────────────────────────────────────────
  const t0 = Date.now();
  (async () => {
    const timer = timing.start(`command:${commandName}`);
    try {
      const ctx = buildCommandContext({ api, event, args });
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

// ── Reaction handler ─────────────────────────────────────────────────────────
const handleReaction = (api, event) => {
  const msgID = event.messageID;
  if (!msgID) return;
  const entry = global.client.reactionListener[msgID];
  if (!entry) return;
  if (entry.author && event.userID !== entry.author) return;
  global._reactionTimestamps.set(msgID, Date.now());
  Promise.resolve(entry.callback({ api, event }))
    .catch(e => console.error("[REACTION ERR]", e.message));
};

// ── Event handler (onChat) ───────────────────────────────────────────────────
const handleEvent = async (rawApi, event) => {
  const api       = global.wrapApiForSafety(rawApi);
  const firstWord = event.body?.trim().split(/ +/)[0]?.toLowerCase();

  for (const cmd of global.eventCommands) {
    if (!cmd.onChat) continue;
    const hasAtt = (event.attachments?.length > 0);
    if (!event.messageID || (!event.body && !hasAtt)) continue;
    if (firstWord && global.commands.get(firstWord) === cmd) continue;
    cmd.onChat({ api, event, message: buildMessageAPI(api, event.threadID, event.messageID) })
      .catch(() => {});
  }
};

// ── MQTT listener with SessionGuard heartbeat ────────────────────────────────
// botIndex is used only for log labels
const startListening = (api, botIndex, botSessionGuard) => {
  let attempts       = 0;
  let listenerActive = false;
  const label        = `Bot-${botIndex}`;

  // ── Pending-thread sweep (runs only from Bot-1) ──────────────────────────
  // Polls the PENDING and OTHER inboxes every 5 minutes and auto-accepts them
  // so Facebook-classified "spam / suspicious" message requests reach the bot.
  if (botIndex === 1 && typeof api.getThreadList === "function") {
    const sweepPendingInboxes = async () => {
      try {
        // Accept from both PENDING (spam/unknown) and OTHER (filtered) inboxes
        for (const tag of ["PENDING", "OTHER"]) {
          let list;
          try { list = await api.getThreadList(30, null, [tag]); } catch { continue; }
          if (!Array.isArray(list) || list.length === 0) continue;

          const ids = list.map(t => t.threadID).filter(Boolean);
          if (ids.length === 0) continue;

          // Accept in batches of 10 to avoid rate-limits
          for (let i = 0; i < ids.length; i += 10) {
            const batch = ids.slice(i, i + 10);
            await new Promise(res => {
              api.handleMessageRequest(batch, true, err => {
                if (err) console.warn(chalk.yellow(`[PENDING] ⚠️ batch accept error: ${err?.message || err}`));
                res();
              });
            });
          }
          console.log(chalk.cyan(`[PENDING] ✅ قبِل ${ids.length} محادثة من ${tag}`));
        }
      } catch (e) {
        console.warn(chalk.yellow(`[PENDING] ⚠️ sweep error: ${e?.message || e}`));
      }
    };

    // First sweep 10s after bot is ready, then every 5 minutes
    setTimeout(sweepPendingInboxes, 10_000);
    setInterval(sweepPendingInboxes, 5 * 60 * 1000);
  }

  const listen = () => {
    if (listenerActive) return;
    listenerActive = true;

    // Track recently auto-accepted threads to avoid redundant API calls
    const _acceptedThreads = new Set();

    api.listenMqtt(async (err, event) => {
      if (err) {
        const errMsg = err.message || "";
        const fatal = /appstate|not logged in|not-logged-in|401|login/i.test(errMsg);
        const retriable = /connection refused|server unavailable|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(errMsg);

        // Always reset listenerActive so listen() can be re-entered after any error
        listenerActive = false;
        attempts++;

        if (!fatal && !retriable) {
          console.warn(chalk.yellow(`[MQTT:${label}] ⚠️ تحذير عابر (${attempts}):`), errMsg);
          return setTimeout(listen, 2000);
        }

        if (fatal) {
          console.error(chalk.red(`[MQTT:${label}] ❌ خطأ قاتل (${attempts}):`), errMsg);
        } else {
          console.warn(chalk.yellow(`[MQTT:${label}] خادم مرفوض — إعادة المحاولة (${attempts}):`), errMsg);
        }
        return setTimeout(listen, Math.min(5000 * attempts, 30000));
      }

      attempts = 0;

      // Reset session idle clock on every event
      botSessionGuard?.heartbeat();

      try {
        if (global.isBanned(event.threadID, event.senderID ?? event.userID)) return;

        // ── Auto-accept incoming message requests ────────────────────────
        // Facebook routes messages from non-friends/unknown senders to the
        // PENDING (spam) folder. Call handleMessageRequest on the thread so
        // the message is moved to the main inbox and the bot can reply.
        // We deduplicate with _acceptedThreads to avoid one API call per message.
        if (
          event.threadID &&
          ["message", "message_reply"].includes(event.type) &&
          !_acceptedThreads.has(event.threadID) &&
          typeof api.handleMessageRequest === "function"
        ) {
          _acceptedThreads.add(event.threadID);
          // Fire-and-forget: don't block the event pipeline
          api.handleMessageRequest([event.threadID], true, (err) => {
            if (err) {
              // Thread was already in inbox — normal, ignore silently
              _acceptedThreads.delete(event.threadID);
            }
          });
        }

        if (["message", "message_reply", "log", "event"].includes(event.type)) {
          handleEvent(api, event).catch(e => console.error(`[EVENT ERR:${label}]`, e.message));
          handleMessage(api, event).catch(e => console.error(`[EVENT ERR:${label}]`, e.message));
        } else if (event.type === "message_reaction") {
          handleReaction(api, event);
        }
      } catch (e) { console.error(`[EVENT ERR:${label}]`, e.message); }
    });
  };

  listen();
  console.log(chalk.green(`[SUCCESS] ${label} يستمع عبر MQTT...`));
};

// ── DB / shutdown ────────────────────────────────────────────────────────────
import { connectDB, flushAllAndDisconnect } from "./db/index";

[
  "SIGTERM",
  "SIGINT"
].forEach(sig => {
  process.on(sig, async () => {
    console.log(chalk.yellow(`[SHUTDOWN] ${sig} — جاري حفظ البيانات...`));
    // Stop all session guards
    for (const botApi of global.botApis) {
      botApi._sessionGuard?.stop();
      botApi._scheduler?.destroy();
    }
    try { await flushAllAndDisconnect(); } catch (_) {}
    process.exit(0);
  });
});

// ── Login one account ────────────────────────────────────────────────────────
function doLogin(credentials, onSuccess, botIndex) {
  const label = `Bot-${botIndex}`;
  // نستخدم loginAsync لأنها تُرجع ctx كامل (يحتوي على jar + fb_dtsg)
  // ثم نعيّن _ctx و _defaultFuncs على api يدوياً لتوافق CookieRefresher/SessionGuard
  (async () => {
    try {
      const ctx = await loginAsync(credentials, {});
      const api = ctx.api;
      // ─── ربط السياق بـ api للتوافق مع الكود الحالي ───────────────────
      api._ctx = ctx;
      // بناء _defaultFuncs: أولاً نجرّب makeDefaults (يحتاج ctx.jar الداخلي)
      // إذا فشل أو لم يكن ctx.jar متاحاً → نستخدم wrapper من ctx._request
      try {
        const makeDefaults = await getMakeDefaults();
        if (makeDefaults && ctx.jar && (ctx.userID || ctx.fbid)) {
          api._defaultFuncs = makeDefaults("", ctx.userID || ctx.fbid, ctx);
        } else if (ctx._request) {
          api._defaultFuncs = buildDefaultFuncsFromRequest(ctx._request);
        }
      } catch (e) {
        if (ctx._request) {
          api._defaultFuncs = buildDefaultFuncsFromRequest(ctx._request);
        }
        console.warn(chalk.yellow(`[LOGIN:${label}] ⚠️ makeDefaults فشل، تم استخدام _request wrapper:`, e.message));
      }
      onSuccess(api);
    } catch (err) {
      const errMsg = err?.message || String(err);
      console.error(chalk.red(`[LOGIN:${label}] ❌ فشل:`, errMsg));
      if (/checkpoint/i.test(errMsg)) {
        console.error(chalk.red(
          `[2FA:${label}] ❌ Checkpoint — استخدم loginViaAPI مع apiServer خارجي موثوق.`
        ));
      }
      console.error(chalk.red(`[LOGIN:${label}] ❌ هذا الحساب لن يتصل، بقية الحسابات تعمل.`));
    }
  })();
}

// ── Post-login setup (one per bot) ──────────────────────────────────────────
function onBotReady(api, botIndex, appStatePath) {
  const label     = `Bot-${botIndex}`;
  const isFirstBot = botIndex === 1;

  api.setOptions({
    forceLogin:     true,
    listenEvents:   true,
    updatePresence: false,
    selfListen:     false,
    online:         true,
    autoMarkRead:   false,
    listenTyping:   false,
    // Chrome/152 — matches fca-2026 stealth-profiles UA pool (Aug 2026)
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7947.67 Safari/537.36",
  });

  console.log(chalk.green(`[LOGIN:${label}] ✅ الاتصال بفيسبوك مستقر`));

  // Register in global list + backward-compat single ref
  global.botApis.push(api);
  if (isFirstBot) global.botApi = api;

  // ── 1. Nexus extended methods ──────────────────────────────────────────────
  if (typeof attachNexusMethods === "function") {
    try {
      attachNexusMethods(api, api._defaultFuncs, api._ctx);
      console.log(chalk.cyan(`[NEXUS:${label}] ✅ Nexus methods attached`));
    } catch (e) {
      console.warn(chalk.yellow(`[NEXUS:${label}] ⚠️ attachNexusMethods فشل:`), e.message);
    }
  }

  // ── 2. PerformanceManager ─────────────────────────────────────────────────
  let perfMgr = null;
  if (typeof getGlobalPerformanceManager === "function") {
    perfMgr = getGlobalPerformanceManager({
      enableCache:   true,
      cacheSize:     2000,
      cacheTTL:      10 * 60 * 1000,
      enableMetrics: true,
      gcIntervalMs:  5 * 60 * 1000,
    });
    if (isFirstBot) {
      global.perfManager = perfMgr;
      cache._bridgePerfManager(perfMgr);
    }
    console.log(chalk.cyan(`[PERF:${label}] ✅ PerformanceManager جاهز`));
  }

  // ── 3. CookieRefresher ────────────────────────────────────────────────────
  if (typeof createCookieRefresher === "function" && api._ctx && api._defaultFuncs) {
    // Each bot refreshes to its own appstate file
    const cookieRefresher = createCookieRefresher({
      intervalMs:     30 * 60 * 1000,
      expiryDays:     60,
      backupEnabled:  false,
      appStatePath:   appStatePath || path.join(import.meta.dir, `appstate${botIndex === 1 ? "" : botIndex}.json`),
    });
    cookieRefresher.attach(api._ctx, api._defaultFuncs);
    console.log(chalk.cyan(`[SESSION:${label}] ✅ CookieRefresher نشط (كل 30 دقيقة)`));
  }

  // ── 4. SessionGuard ───────────────────────────────────────────────────────
  let sessionGuard = null;
  if (typeof createSessionGuard === "function") {
    sessionGuard = createSessionGuard({
      enabled:            true,
      watchdogIdleMs:     10 * 60 * 1000,
      watchdogIntervalMs: 60_000,
    });
    if (api._ctx) {
      sessionGuard.attach(api._ctx, {
        onStale: (_ctx) => {
          console.warn(chalk.yellow(`[SESSION:${label}] ⚠️ الجلسة خاملة منذ 10 دقائق — قد يكون MQTT توقف.`));
        },
      });
    }
    // Store per-bot reference on the api object itself for shutdown cleanup
    api._sessionGuard = sessionGuard;
    if (isFirstBot) global.sessionGuard = sessionGuard;
    console.log(chalk.cyan(`[SESSION:${label}] ✅ SessionGuard نشط`));
  }

  // ── 5. Thread-info realtime sync ──────────────────────────────────────────
  // التوقيع الصحيح في vendor: attachThreadInfoRealtimeSync(ctx, models, logger, api)
  // يحتاج Thread model — بدونه يعود false فوراً (لا ضرر)
  if (typeof attachThreadInfoRealtimeSync === "function" && api._ctx) {
    try {
      attachThreadInfoRealtimeSync(api._ctx, null, null, api);
      console.log(chalk.cyan(`[SYNC:${label}] ✅ Thread-info realtime sync نشط`));
    } catch (e) {
      console.warn(chalk.yellow(`[SYNC:${label}] ⚠️ attachThreadInfoRealtimeSync:`), e.message);
    }
  }

  // ── 6. Scheduler domain ───────────────────────────────────────────────────
  if (typeof createSchedulerDomain === "function") {
    const scheduler = createSchedulerDomain({
      sendMessage: (msg, tid, cb, replyID) => {
        return new Promise((res, rej) => {
          global.safeSend(api, msg, tid, (err, info) => {
            if (err) { rej(err); cb?.(err); }
            else     { res(info); cb?.(null, info); }
          }, replyID);
        });
      },
    });
    // Store per-bot reference for shutdown cleanup
    api._scheduler = scheduler;
    if (isFirstBot) global.scheduler = scheduler;
    console.log(chalk.cyan(`[SCHEDULER:${label}] ✅ Scheduler Domain جاهز`));
  }

  // ── 7. Bot enhancer ───────────────────────────────────────────────────────
  botEnhancer(api);

  // ── 8. Persist AppState for this bot ─────────────────────────────────────
  const freshState = api.getAppState();
  if (freshState?.length) {
    saveAppStateForBot(freshState, botIndex);
    if (isFirstBot) global.appState = freshState;
  }

  // Auto-persist AppState every 2 hours
  setInterval(() => {
    try {
      const refreshed = api.getAppState();
      if (refreshed?.length) {
        saveAppStateForBot(refreshed, botIndex);
        if (isFirstBot) global.appState = refreshed;
        console.log(chalk.cyan(`[SESSION:${label}] 🔄 AppState جُدِّد`));
        sessionGuard?.save();
      }
    } catch (_) {}
  }, 2 * 60 * 60 * 1000);

  // ── 9. Wait for DB then start MQTT ────────────────────────────────────────
  (async () => {
    if (_dbReadyPromise) { try { await _dbReadyPromise; } catch (_) {} }
    startListening(api, botIndex, sessionGuard);
  })();

  // ── 10. Daily tick — fires onSchedule on all commands that define it ────────
  // Runs only from Bot-1 to avoid sending duplicate messages from each bot.
  if (isFirstBot) {
    // Calculate ms until next midnight (local TZ = Europe/Berlin set at top)
    const msUntilMidnight = () => {
      const now  = new Date();
      const next = new Date(now);
      next.setHours(24, 0, 0, 0);   // next midnight
      return next - now;
    };

    const fireDailyTick = () => {
      const tick = { label: "daily", firedAt: new Date().toISOString() };
      console.log(chalk.magenta(`[SCHEDULE] 🕛 Daily tick — ${global.scheduledCommands.length} أمر مجدوَل`));
      for (const cmd of global.scheduledCommands) {
        try {
          // Pass api (first bot) so commands can send messages
          cmd.onSchedule({ api, tick });
        } catch (e) {
          console.warn(chalk.yellow(`[SCHEDULE] ⚠️ ${cmd.config?.name}: ${e.message}`));
        }
      }
      // Re-schedule for next midnight
      setTimeout(fireDailyTick, msUntilMidnight());
    };

    // First fire at next midnight, then every 24h precisely
    setTimeout(fireDailyTick, msUntilMidnight());
    console.log(chalk.magenta(
      `[SCHEDULE] ✅ Daily tick مُجدوَل — سيُطلَق عند منتصف الليل القادم ` +
      `(خلال ${Math.round(msUntilMidnight() / 60000)} دقيقة)`
    ));
  }

  // ── 11. Cleanup (only run once from Bot-1 to avoid duplicate intervals) ──
  if (isFirstBot) {
    setInterval(() => {
      const now     = Date.now();
      let   cleaned = 0;

      // Stale replies (> 10 min)
      for (const [id, data] of Object.entries(global.Kagenou.replies)) {
        if (now - (data.timestamp || 0) > 10 * 60 * 1000) {
          delete global.Kagenou.replies[id]; cleaned++;
        }
      }
      // Expired cooldowns
      for (const [key, exp] of global.userCooldowns.entries()) {
        if (now >= exp) { global.userCooldowns.delete(key); cleaned++; }
      }
      // Idle usersData (> 1 hour unseen)
      for (const [uid, data] of global.usersData.entries()) {
        if (data._lastSeen && now - data._lastSeen > 60 * 60 * 1000) {
          global.usersData.delete(uid); cleaned++;
        }
      }
      // Stale reaction listeners (> 10 min)
      for (const [msgID, ts] of global._reactionTimestamps.entries()) {
        if (now - ts > 10 * 60 * 1000) {
          delete global.client.reactionListener[msgID]; cleaned++;
        }
      }

      cleanupOrphanTempFiles();
      try { cleaned += cache.sweep(); } catch (_) {}
      try { cleaned += global.cleanupIdleThreadGates(); } catch (_) {}

      if (typeof Bun !== "undefined" && typeof Bun.gc === "function") {
        try { Bun.gc(true); } catch (_) {}
      } else if (typeof global.gc === "function") {
        try { global.gc(); } catch (_) {}
      }

      const mem = process.memoryUsage();
      const pm  = global.perfManager?.getMetrics();
      console.log(chalk.cyan(
        `[CLEANUP] 🧹 ${cleaned} مدخلة | RSS: ${Math.round(mem.rss/1024/1024)}MB` +
        ` | Heap: ${Math.round(mem.heapUsed/1024/1024)}/${Math.round(mem.heapTotal/1024/1024)}MB` +
        (pm ? ` | Cache: ${pm.cacheSize} (hit ${(pm.cacheHitRate * 100).toFixed(0)}%) | avg: ${pm.avgResponseTimeMs}ms` : "") +
        ` | Bots: ${global.botApis.length}`
      ));
    }, 10 * 60 * 1000);
  }
}

// ── Login one bot account via AppState ──────────────────────────────────────
function loginBotWithAppState(account, onFallback) {
  const { state, filePath, index } = account;
  const label = `Bot-${index}`;
  console.log(chalk.blue(`[LOGIN:${label}] 🔑 تسجيل الدخول بـ AppState (${account.source})...`));
  // نستخدم loginAsync لاستقبال ctx الكامل مع jar و fb_dtsg
  (async () => {
    try {
      const ctx = await loginAsync({ appState: state }, {});
      const api = ctx.api;
      // ─── ربط السياق بـ api للتوافق مع CookieRefresher/SessionGuard ──
      api._ctx = ctx;
      try {
        const makeDefaults = await getMakeDefaults();
        if (makeDefaults && ctx.jar && (ctx.userID || ctx.fbid)) {
          api._defaultFuncs = makeDefaults("", ctx.userID || ctx.fbid, ctx);
        } else if (ctx._request) {
          api._defaultFuncs = buildDefaultFuncsFromRequest(ctx._request);
        }
      } catch (e) {
        if (ctx._request) {
          api._defaultFuncs = buildDefaultFuncsFromRequest(ctx._request);
        }
        console.warn(chalk.yellow(`[LOGIN:${label}] ⚠️ makeDefaults فشل، تم استخدام _request wrapper:`, e.message));
      }
      console.log(chalk.green(`[LOGIN:${label}] ✅ AppState نجح`));
      onBotReady(api, index, filePath);
    } catch (err) {
      const errMsg = err?.message || String(err);
      if (/checkpoint/i.test(errMsg)) {
        console.log(chalk.yellow(`[2FA:${label}] ⚡ Checkpoint — جرب loginViaAPI مع apiServer.`));
      }
      if (index === 1 && onFallback) {
        onFallback(errMsg);
      } else {
        console.error(chalk.red(`[LOGIN:${label}] ❌ فشل AppState — هذا الحساب متوقف.`));
      }
    }
  })();
}

// ── Entry point ──────────────────────────────────────────────────────────────
let _dbReadyPromise = null;

const startBot = async () => {
  startWebServer();
  cleanupOrphanTempFiles();

  // Collect all available accounts
  const accounts = loadAllAppStates();

  console.log(chalk.magenta(`[MULTI] 🚀 وجد ${accounts.length} حساب للتشغيل`));

  if (accounts.length === 0) {
    // No appstate files → fall back to email/password for Bot-1
    fallbackToEmailLogin("لا يوجد أي appstate");
  } else {
    // Login all accounts in parallel — each independently
    for (const account of accounts) {
      const isFirst = account.index === 1;
      loginBotWithAppState(
        account,
        isFirst ? (errMsg) => fallbackToEmailLogin(errMsg) : null
      );
    }
  }

  loadCommands();
  _dbReadyPromise = connectDB().catch(e => {
    console.error(chalk.red("[DB] ❌ فشل الاتصال (بدون تخزين دائم):"), e.message);
  });
};

function fallbackToEmailLogin(reason) {
  console.log(chalk.yellow(`[LOGIN] ⚠️ AppState فشل (${reason?.substring?.(0, 80) || reason})`));
  console.log(chalk.blue("[LOGIN] 🔄 الانتقال لـ Email/Password..."));
  if (!FB_EMAIL || !FB_PASSWORD) {
    console.error(chalk.red("[LOGIN] ❌ بيانات Email/Password غير مضبوطة في .env"));
    process.exit(1);
  }
  doLogin({ email: FB_EMAIL, password: FB_PASSWORD }, (api) => {
    console.log(chalk.green("[LOGIN] ✅ Email/Password نجح"));
    onBotReady(api, 1, path.join(import.meta.dir, "appstate.json"));
  }, 1);
}

startBot();
