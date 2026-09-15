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
// Per-bot admin map: botIndex (Number) → fbId (String)
// Populated from Postgres vault (hydrateAppStatesFromVault) or botAdmins.json fallback
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

import "./src/utils/safeSend.js";
import { startWebServer } from "./src/server/webServer.js";
import { loadConfig } from "./src/config/index.js";
import { loadCommands } from "./src/core/Loader.js";
import { connectDB, flushAllAndDisconnect } from "./src/db/index.js";
import * as appStateVault from "./src/db/postgres.js";
import {
  PROJECT_ROOT,
  loadAllAppStates,
  hydrateAppStatesFromVault,
  loginBotWithAppState,
} from "./src/core/Client.js";
import { cleanupOrphanTempFiles } from "./src/utils/tempCleanup.js";

try { await import("dotenv/config"); } catch (_) {}

checkEnv(PROJECT_ROOT);

global.log = {
  info:    msg => console.log("[INFO]",    msg),
  warn:    msg => console.log("[WARN]",  msg),
  error:   msg => console.log("[ERROR]",    msg),
  success: msg => console.log("[SUCCESS]", msg),
};

loadConfig(PROJECT_ROOT);

const COMMANDS_DIR = path.join(PROJECT_ROOT, "src", "commands");

// reloadCommands لا تعيد تشغيل scheduledCommands لأنها محذوفة
global.reloadCommands = () => loadCommands(COMMANDS_DIR);

["SIGTERM", "SIGINT"].forEach(sig => {
  process.on(sig, async () => {
    console.log(`[SHUTDOWN] ${sig} — جاري حفظ البيانات...`);
    for (const botApi of global.botApis) {
      botApi._sessionGuard?.stop();
      botApi._scheduler?.destroy();
      // تحرير ملف القفل حتى لا يبقى orphan lock عند إعادة التشغيل
      try { botApi.__sessionLock?.release(); } catch (_) {}
    }
    try { await flushAllAndDisconnect(); } catch (_) {}
    process.exit(0);
  });
});

function reportNoLoginCredentials() {
  console.error("[LOGIN] ❌ لا يوجد أي appstate (لم يُضَف أي حساب بعد).");
  console.error("[LOGIN] ➜ افتح لوحة التحكم (/dashboard) وأضف حساب فيسبوك من تبويب AppState، ثم ستتصل الجلسة فوراً.");
}

const startBot = async () => {
  await appStateVault.init();
  startWebServer();
  cleanupOrphanTempFiles();
  await hydrateAppStatesFromVault();

  // تحميل الأوامر أولاً قبل أي login لتجنب race condition
  await loadCommands(COMMANDS_DIR);

  const accounts = loadAllAppStates();
  console.log(`[MULTI] 🚀 وجد ${accounts.length} حساب للتشغيل`);

  // DB بالتوازي مع login (لا يعطّل البدء)
  const _dbReadyPromise = connectDB().catch(e => {
    console.error("[DB] ❌ فشل الاتصال (بدون تخزين دائم):", e.message);
  });

  // Auto-cleanup stale AI chat sessions (GPT / Gemini / Groq) older than 30 days.
  // Runs once on startup then every 24 hours so old threads don't fill MongoDB.
  _dbReadyPromise.then(async () => {
    const runSessionCleanup = async () => {
      if (!global.db) return;
      const cutoff    = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const mongoose  = (await import("mongoose")).default;
      const colNames  = ["gptx_sessions", "gemini_sessions", "groq_sessions"];
      let totalDeleted = 0;
      for (const col of colNames) {
        try {
          const result = await mongoose.connection.collection(col).deleteMany({
            updatedAt: { $lt: cutoff },
          });
          totalDeleted += result.deletedCount || 0;
        } catch (_) { /* collection may not exist yet — skip */ }
      }
      if (totalDeleted > 0)
        console.log(`[AI-SESSION] 🧹 حُذف ${totalDeleted} جلسة AI منتهية الصلاحية (>30 يوم).`);
    };
    runSessionCleanup();
    setInterval(runSessionCleanup, 24 * 60 * 60 * 1000);
  }).catch(() => {});

  if (accounts.length === 0) {
    reportNoLoginCredentials();
  } else {
    // [FIX P2] نُشغّل الحسابات بالتوازي مع انتظار النتائج لكشف الفشل
    const results = await Promise.allSettled(
      accounts.map(account => loginBotWithAppState(account, null, _dbReadyPromise))
    );
    const failed  = results.filter(r => r.status === "rejected");
    const succeed = results.filter(r => r.status === "fulfilled");
    if (succeed.length > 0) console.log(`[MULTI] ✅ ${succeed.length}/${accounts.length} حساب متصل`);
    if (failed.length  > 0) console.warn(`[MULTI] ⚠️ ${failed.length}/${accounts.length} حساب فشل الدخول`);
  }
};

startBot();
