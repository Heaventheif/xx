"use strict";
process.env.TZ = 'Europe/Berlin';

const FB_EMAIL    = process.env.FB_EMAIL    || "";
const FB_PASSWORD = process.env.FB_PASSWORD || "";

import { checkEnv } from "./utils/envCheck";

process.on("uncaughtException", (err) => {
  if (err.code === "EPIPE" || err.code === "ECONNRESET" || err.code === "ETIMEDOUT") return;
  console.error("[uncaughtException]", err.message);
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
global.appState            = {};
global.botApi              = null;
global.scheduler           = null;  // createSchedulerDomain — set in onLoginSuccess
global.perfManager         = null;  // PerformanceManager from fca — set in onLoginSuccess
global.sessionGuard        = null;  // SessionGuard — set in onLoginSuccess

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
import { saveAppState } from "./utils/sessionState";
import { startWebServer } from "./server/webServer";

// ── fca-unofficial: core + performance + safety + nexus ─────────────────────
import * as fcaModule from "fca-unofficial";
const login = fcaModule.login ?? fcaModule.default;

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
    mod:     resolved,
    handler: resolved[handlerKey || namedHandler] || null,
    onChat:  resolved.onChat  || raw.onChat  || null,
    onReply: resolved.onReply || raw.onReply || null,
  };
}

const loadCommands = async () => {
  const dir = path.join(import.meta.dir, "cmds");
  if (!fs.existsSync(dir)) return [];
  global.commands.clear();
  global.eventCommands = [];

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

      const { name, mod, onChat, onReply } = resolved;
      global.commands.set(name, mod);
      (mod.config?.aliases || []).forEach(a => global.commands.set(String(a).toLowerCase(), mod));
      if (onReply && !mod.onReply) mod.onReply = onReply;
      if (onChat)  { if (!mod.onChat) mod.onChat = onChat; global.eventCommands.push(mod); }

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

// ── AppState loading ─────────────────────────────────────────────────────────
try {
  const p = path.join(import.meta.dir, "appstate.json");
  if (fs.existsSync(p)) {
    global.appState = JSON.parse(fs.readFileSync(p, "utf8"));
  } else if (process.env.APPSTATE || process.env.APPSTATE_BOT1) {
    global.appState = JSON.parse(process.env.APPSTATE || process.env.APPSTATE_BOT1);
  }
} catch { }

// ── Message handler ──────────────────────────────────────────────────────────
const handleMessage = async (rawApi, event) => {
  const { threadID, senderID, body, messageReply, messageID } = event;
  const hasAttachment = (event.attachments?.length > 0);
  if (!body?.trim() && !hasAttachment) return;

  const api         = global.wrapApiForSafety(rawApi);
  const messageText = body.trim();

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
const startListening = (api) => {
  let attempts       = 0;
  let listenerActive = false;

  const listen = () => {
    if (listenerActive) return;
    listenerActive = true;

    api.listenMqtt(async (err, event) => {
      if (err) {
        const fatal = /appstate|not logged in|not-logged-in|401|login/i.test(err.message || "");
        if (!fatal) {
          console.warn(chalk.yellow("[MQTT] ⚠️ تحذير عابر:"), err.message);
          return;
        }
        listenerActive = false;
        attempts++;
        console.error(chalk.red(`[MQTT] خطأ قاتل (${attempts}):`, err.message));
        return setTimeout(listen, Math.min(5000 * attempts, 30000));
      }

      attempts = 0;

      // Reset session idle clock on every event
      global.sessionGuard?.heartbeat();

      try {
        if (global.isBanned(event.threadID, event.senderID ?? event.userID)) return;

        if (["message", "message_reply", "log", "event"].includes(event.type)) {
          handleEvent(api, event).catch(e => console.error("[EVENT ERR]", e.message));
          handleMessage(api, event).catch(e => console.error("[EVENT ERR]", e.message));
        } else if (event.type === "message_reaction") {
          handleReaction(api, event);
        }
      } catch (e) { console.error("[EVENT ERR]", e.message); }
    });
  };

  listen();
  console.log(chalk.green("[SUCCESS] Bot listening via MQTT..."));
};

// ── DB / shutdown ────────────────────────────────────────────────────────────
import { connectDB, flushAllAndDisconnect } from "./db/index";

["SIGTERM", "SIGINT"].forEach(sig => {
  process.on(sig, async () => {
    console.log(chalk.yellow(`[SHUTDOWN] ${sig} — جاري حفظ البيانات...`));
    global.sessionGuard?.stop();
    global.scheduler?.destroy();
    try { await flushAllAndDisconnect(); } catch (_) {}
    process.exit(0);
  });
});

// ── Login ────────────────────────────────────────────────────────────────────
function doLogin(credentials, onSuccess) {
  login(credentials, (err, api) => {
    if (!err) return onSuccess(api);
    const errMsg = err?.message || String(err);
    console.error(chalk.red("[LOGIN] ❌ فشل:", errMsg));
    if (/checkpoint/i.test(errMsg)) {
      console.error(chalk.red(
        "[2FA] ❌ Checkpoint — استخدم loginViaAPI/tokensViaAPI مع apiServer خارجي موثوق."
      ));
      process.exit(1);
    }
    process.exit(1);
  });
}

// ── Post-login setup ─────────────────────────────────────────────────────────
function onLoginSuccess(api) {
  api.setOptions({
    forceLogin:     true,
    listenEvents:   true,
    updatePresence: false,
    selfListen:     false,
    online:         true,
    autoMarkRead:   false,
    listenTyping:   false,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });

  console.log(chalk.green("[LOGIN] ✅ الاتصال بفيسبوك مستقر"));

  global.botApi = api;

  // ── 1. Nexus extended methods ──────────────────────────────────────────────
  // Adds: listenSpeed, getBotInitialData, getCtx, listenRealtime,
  //       follow, setStoryReaction, changeCover, etc.
  if (typeof attachNexusMethods === "function") {
    try {
      attachNexusMethods(api, api._defaultFuncs, api._ctx);
      console.log(chalk.cyan("[NEXUS] ✅ Nexus methods attached"));
    } catch (e) {
      console.warn(chalk.yellow("[NEXUS] ⚠️ attachNexusMethods فشل:"), e.message);
    }
  }

  // ── 2. Global PerformanceManager (cache + metrics from fca layer) ──────────
  if (typeof getGlobalPerformanceManager === "function") {
    global.perfManager = getGlobalPerformanceManager({
      enableCache:   true,
      cacheSize:     2000,       // max cached entries
      cacheTTL:      10 * 60 * 1000, // 10 min default TTL
      enableMetrics: true,
      gcIntervalMs:  5 * 60 * 1000, // sweep every 5 min
    });
    // Bridge local cache.js hit/miss stats into perfManager
    cache._bridgePerfManager(global.perfManager);
    console.log(chalk.cyan("[PERF] ✅ PerformanceManager جاهز"));
  }

  // ── 3. CookieRefresher — keeps session alive automatically ────────────────
  if (typeof createCookieRefresher === "function" && api._ctx && api._defaultFuncs) {
    const appStatePath = path.join(import.meta.dir, "appstate.json");
    const cookieRefresher = createCookieRefresher({
      intervalMs:     30 * 60 * 1000, // refresh every 30 min
      expiryDays:     60,
      backupEnabled:  false,
      appStatePath,
    });
    cookieRefresher.attach(api._ctx, api._defaultFuncs);
    console.log(chalk.cyan("[SESSION] ✅ CookieRefresher نشط (كل 30 دقيقة)"));
  }

  // ── 4. SessionGuard — detects idle / stale session ────────────────────────
  if (typeof createSessionGuard === "function") {
    global.sessionGuard = createSessionGuard({
      enabled:            true,
      watchdogIdleMs:     10 * 60 * 1000, // 10 min idle = stale
      watchdogIntervalMs: 60_000,
    });
    if (api._ctx) {
      global.sessionGuard.attach(api._ctx, {
        onStale: (_ctx) => {
          console.warn(chalk.yellow("[SESSION] ⚠️ الجلسة خاملة منذ 10 دقائق — قد يكون MQTT توقف."));
        },
      });
    }
    console.log(chalk.cyan("[SESSION] ✅ SessionGuard نشط"));
  }

  // ── 5. Thread-info realtime sync (reduce getThreadInfo HTTP calls) ─────────
  if (typeof attachThreadInfoRealtimeSync === "function" && api._ctx) {
    try {
      attachThreadInfoRealtimeSync(api, api._ctx);
      console.log(chalk.cyan("[SYNC] ✅ Thread-info realtime sync نشط"));
    } catch (e) {
      console.warn(chalk.yellow("[SYNC] ⚠️ attachThreadInfoRealtimeSync:"), e.message);
    }
  }

  // ── 6. Scheduler domain — expose to commands via global.scheduler ──────────
  if (typeof createSchedulerDomain === "function") {
    global.scheduler = createSchedulerDomain({
      sendMessage: (msg, tid, cb, replyID) => {
        return new Promise((res, rej) => {
          global.safeSend(api, msg, tid, (err, info) => {
            if (err) { rej(err); cb?.(err); }
            else     { res(info); cb?.(null, info); }
          }, replyID);
        });
      },
    });
    console.log(chalk.cyan("[SCHEDULER] ✅ Scheduler Domain جاهز"));
  }

  // ── 7. Bot enhancer (human-like typing, non-blocking) ─────────────────────
  botEnhancer(api);

  // ── 8. Persist AppState ────────────────────────────────────────────────────
  const freshState = api.getAppState();
  if (freshState?.length) { saveAppState(freshState); global.appState = freshState; }

  // Auto-persist AppState every 2 hours
  setInterval(() => {
    try {
      const refreshed = api.getAppState();
      if (refreshed?.length) {
        saveAppState(refreshed);
        global.appState = refreshed;
        console.log(chalk.cyan("[SESSION] 🔄 AppState جُدِّد"));
        global.sessionGuard?.save();
      }
    } catch (_) {}
  }, 2 * 60 * 60 * 1000);

  // ── 9. Wait for DB, then start MQTT listener ───────────────────────────────
  (async () => {
    if (_dbReadyPromise) { try { await _dbReadyPromise; } catch (_) {} }
    startListening(api);
  })();

  // ── 10. Periodic cleanup (replies / cooldowns / cache / temp files) ────────
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

    // GC hint
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
      (pm ? ` | Cache: ${pm.cacheSize} (hit ${(pm.cacheHitRate * 100).toFixed(0)}%) | avg: ${pm.avgResponseTimeMs}ms` : "")
    ));
  }, 10 * 60 * 1000);
}

// ── Entry point ──────────────────────────────────────────────────────────────
let _dbReadyPromise = null;

const startBot = async () => {
  startWebServer();
  cleanupOrphanTempFiles();

  const appStateFile = path.join(import.meta.dir, "appstate.json");
  const hasAppState  = fs.existsSync(appStateFile) || global.appState?.length > 0;

  if (hasAppState) {
    console.log(chalk.blue("[LOGIN] 🔑 تسجيل الدخول بـ AppState..."));
    login({ appState: global.appState }, (err, api) => {
      if (!err) { console.log(chalk.green("[LOGIN] ✅ AppState نجح")); return onLoginSuccess(api); }
      const errMsg = err?.message || String(err);
      if (/checkpoint/i.test(errMsg)) {
        console.log(chalk.yellow("[2FA] ⚡ AppState وصل لـ Checkpoint — التحويل لـ Email/Password..."));
      }
      fallbackToEmailLogin(errMsg);
    });
  } else {
    fallbackToEmailLogin("لا يوجد appstate.json");
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
    onLoginSuccess(api);
  });
}

startBot();
