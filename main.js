"use strict";
process.env.TZ = 'Europe/Berlin';
import path from "path";
import { checkEnv } from "./src/utils/envCheck.js";

global.__critLogLast = 0;
process.on("uncaughtException", (err) => {
  if (err.code === "EPIPE" || err.code === "ECONNRESET" || err.code === "ETIMEDOUT") return;
  const now = Date.now();
  if (now - global.__critLogLast > 5000) {
    global.__critLogLast = now;
    console.error("[uncaughtException]", err?.stack || err?.message || err);
  }
});
function safeStringify(v) {
  if (v instanceof Error) return v.stack || v.message;
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}
process.on("unhandledRejection", (reason) => {
  const msg = safeStringify(reason);
  if (msg.includes("EPIPE") || msg.includes("ECONNRESET") || msg.includes("ETIMEDOUT")) return;
  console.error("[unhandledRejection]", msg);
});

// Reaction listener مع proxy لتتبع الطوابع الزمنية
const _reactionTimestamps  = new Map();
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

global.client              = { reactionListener: reactionListenerProxy };
global._reactionTimestamps = _reactionTimestamps;
global.Kagenou             = { replies: {} };
global.config              = { admins: [], moderators: [], developers: [], vips: [], Prefix: ["."], botName: "Sunken Bot" };
global._botAdminIds        = new Map();
global.globalData          = new Map();
global.usersData           = new Map();
global.userCooldowns       = new Map();
global.commands            = new Map();
global.eventCommands       = [];
global.appState            = {};
global.botApi              = null;
global.botApis             = [];
global.scheduler           = null;
global.perfManager         = null;
global.sessionGuard        = null;
// قاعدة بيانات معطّلة
global.db                  = null;

import "./src/utils/safeSend.js";
import { startWebServer } from "./src/webServer.js";
import { loadConfig } from "./src/config/index.js";
import { loadCommands } from "./src/core/Loader.js";
import {
  PROJECT_ROOT,
  loadAllAppStates,
  loginBotWithAppState,
} from "./src/core/Client.js";
import { cleanupOrphanTempFiles } from "./src/utils/tempCleanup.js";

try { await import("dotenv/config"); } catch (_) {}

checkEnv(PROJECT_ROOT);

global.log = {
  info:    msg => console.log("[INFO]",    msg),
  warn:    msg => console.log("[WARN]",    msg),
  error:   msg => console.log("[ERROR]",   msg),
  success: msg => console.log("[SUCCESS]", msg),
};

loadConfig(PROJECT_ROOT);

const COMMANDS_DIR = path.join(PROJECT_ROOT, "src", "commands");

global.reloadCommands = () => loadCommands(COMMANDS_DIR);

["SIGTERM", "SIGINT"].forEach(sig => {
  process.on(sig, async () => {
    console.log(`[SHUTDOWN] ${sig} — جاري إيقاف الجلسات...`);
    for (const botApi of global.botApis) {
      try { await botApi.__stopSessionLifecycle?.(); } catch (_) {}
      botApi._scheduler?.destroy();
      try { botApi.__sessionLock?.release(); } catch (_) {}
    }
    process.exit(0);
  });
});

const startBot = async () => {
  startWebServer();
  cleanupOrphanTempFiles();

  await loadCommands(COMMANDS_DIR);

  const accounts = loadAllAppStates();
  console.log(`[MULTI] 🚀 وجد ${accounts.length} حساب للتشغيل`);

  if (accounts.length === 0) {
    console.error("[LOGIN] ❌ لا يوجد أي appstate — أضف APPSTATE في متغيرات البيئة.");
  } else {
    const results = await Promise.allSettled(
      accounts.map(account => loginBotWithAppState(account, null))
    );
    const failed  = results.filter(r => r.status === "rejected");
    const succeed = results.filter(r => r.status === "fulfilled");
    if (succeed.length > 0) console.log(`[MULTI] ✅ ${succeed.length}/${accounts.length} حساب متصل`);
    if (failed.length  > 0) console.warn(`[MULTI] ⚠️ ${failed.length}/${accounts.length} حساب فشل الدخول`);
  }
};

startBot();
