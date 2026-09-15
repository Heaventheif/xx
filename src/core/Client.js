"use strict";
import fs from "fs-extra";
import path from "path";
import { createRequire } from "node:module";
import botEnhancer from "../utils/bot-enhancer.js";
import cache from "../utils/cache.js";
import { dispatchMqttEvent } from "../events/onMessage.js";
import { startCleanupInterval } from "../events/onReady.js";
import { bugLog, readAppStateFromEnv, updateAppStateInMemory } from "../utils/runtimeEnv.js";
import {
  saveAppStateToMongo,
  resolveAppState,
  checkAppStateExpiry,
} from "../utils/appStatePersist.js";
import { createSessionExtender } from "../safety/session-extender.js";
import { createMqttConnectionManager } from "./MqttConnectionManager.js";
if (typeof Bun === "undefined" || !Bun.version?.startsWith?.("1.")) {
  console.error("[FATAL] هذا البوت يتطلب Bun 1.4 أو أحدث — https://bun.sh");
  process.exit(1);
}
const PROJECT_ROOT = path.join(import.meta.dir, "..", "..");
import * as fcaModule from "fca-unofficial";
const loginAsync = fcaModule.loginAsync;
const {
  attachNexusMethods,
  getGlobalPerformanceManager,
  createCookieRefresher,
  createSessionGuard,
  attachThreadInfoRealtimeSync,
  createSchedulerDomain,
  defaultConfig: fcaDefaultConfig,
  DeviceManager,
  SingleSessionGuard,
  StealthMode,
} = fcaModule;
console.log(
  "[FCA] apiServer:", JSON.stringify(fcaDefaultConfig?.apiServer ?? ""),
  "| autoLogin:", fcaDefaultConfig?.autoLogin
);
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
function buildDefaultFuncsFromRequest(ctxRequest) {
  if (!ctxRequest) return null;
  return {
    get:         (url, _jar, qs)       => ctxRequest.get(url, { params: qs }),
    post:        (url, _jar, form)     => ctxRequest.post(url, form),
    postFormData:(url, _jar, form, qs) => ctxRequest.postFormData(url, form, { params: qs }),
  };
}
const BOT_NAMES_FILE = path.join(PROJECT_ROOT, "botNames.json");
function loadBotNames() {
  try {
    if (fs.existsSync(BOT_NAMES_FILE)) {
      return JSON.parse(fs.readFileSync(BOT_NAMES_FILE, "utf8")) || {};
    }
  } catch (_) {}
  return {};
}
function saveBotName(botIndex, name) {
  if (!name) return;
  try {
    const all = loadBotNames();
    all[String(botIndex)] = name;
    const tmpPath = BOT_NAMES_FILE + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(all, null, 2), "utf8");
    fs.renameSync(tmpPath, BOT_NAMES_FILE);
  } catch (e) {
    console.warn("[BOT-NAME] ⚠️ فشل حفظ اسم الحساب:", e.message);
  }
}
function getBotName(botIndex) {
  return loadBotNames()[String(botIndex)] || null;
}
function parseEnvAppState() {
  return readAppStateFromEnv();
}

function saveAppStateForBot(state, _botIndex = 1) {
  try {
    if (!Array.isArray(state) || state.length === 0) {
      throw new Error("AppState فارغ أو ليس مصفوفة");
    }
    const names = new Set(state.map((cookie) => String(cookie?.key ?? cookie?.name ?? "")));
    if (!names.has("c_user") || !names.has("xs")) {
      throw new Error("AppState يفتقد cookies أساسية (c_user أو xs)");
    }

    // 1. حفظ في الذاكرة (process.env) — فوري ومتزامن
    updateAppStateInMemory(state);
    console.log(`[APPSTATE] تم تحديث الحالة الحية للحساب ${_botIndex}.`);

    // 2. حفظ في MongoDB — غير متزامن (fire-and-forget مع تسجيل الأخطاء)
    saveAppStateToMongo(state, _botIndex, "runtime").catch((err) => {
      console.warn(`[APPSTATE] ⚠️ فشل الحفظ في MongoDB (تأجيل): ${err.message}`);
    });

    return true;
  } catch (error) {
    bugLog("APPSTATE", "Rejected refreshed state", error);
    console.warn(`[APPSTATE] ${error.message}`);
    return false;
  }
}

function loadAllAppStates() {
  // القراءة من البيئة فقط — متزامن وسريع.
  // المقارنة مع MongoDB تحدث لاحقاً داخل loginBotWithAppState()
  // لأن connectDB() غير متزامن وقد لا يكون انتهى بعد في هذه المرحلة.
  const state = parseEnvAppState();
  if (!state) return [];
  bugLog("APPSTATE", "Pre-login env state loaded", { botIndex: 1 });
  return [{ state, filePath: null, index: 1, source: "APPSTATE", uid: null, freshness: Date.now() }];
}

function safeStringify(v) {
  if (v instanceof Error) return v.stack || v.message;
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

// ─── Helper: إيقاف مستمع MQTT بأمان ─────────────────────────────────────────
function stopMqttListener(listener, label) {
  if (!listener) return;
  try {
    if (typeof listener.stopListeningAsync === "function") {
      listener.stopListeningAsync().catch(() => {});
    } else {
      listener.stopListening?.();
    }
  } catch (e) {
    console.warn(`[MQTT:${label}] ⚠️ تعذّر إيقاف المستمع القديم:`, e.message);
  }
}

function startListening(api, botIndex, botSessionGuard) {
  const label = `Bot-${botIndex}`;
  if (api.__mqttManager) {
    console.warn(`[MQTT:${label}] manager موجود؛ سيتم طلب إعادة اتصال single-flight.`);
    return api.__mqttManager.reconnect("duplicate_start");
  }

  const acceptedThreads = api._acceptedThreads || (api._acceptedThreads = new Set());
  const manager = createMqttConnectionManager(api, {
    label,
    botIndex,
    onState: (health) => {
      api.__mqttHealth = health;
      global._mqttHealthByBot = global._mqttHealthByBot || new Map();
      global._mqttHealthByBot.set(botIndex, health);
      if (health.state === "CONNECTED") botSessionGuard?.heartbeat();
    },
    onEvent: (event) => {
      botSessionGuard?.heartbeat();
      if (global._pausedBots?.has(botIndex)) return;
      try {
        dispatchMqttEvent(api, event, label, acceptedThreads);
      } catch (error) {
        console.error(`[EVENT ERR:${label}]`, error.message || error);
      }
    },
  });

  api.__mqttManager = manager;
  api.__forceReconnect = (reason = "manual") => manager.reconnect(reason);
  api.__stopWatchdog = () => manager.stop();
  api.__restartWatchdog = () => manager.start();
  api.__mqttHealth = manager.health();
  manager.on("auth_failed", (health) => {
    console.error(`[MQTT:${label}] AppState مرفوض؛ لن تتم إعادة المصادقة تلقائياً.`, health.lastError || "auth failed");
  });
  manager.on("cooldown", (health) => {
    console.warn(`[MQTT:${label}] دخل cooldown حتى ${health.cooldownUntil}`);
  });
  manager.start();
  console.log(`[SUCCESS] ${label} مدير MQTT مرن نشط مع single-flight وhealth metrics.`);
  return manager;
}

async function onBotReady(api, botIndex) {
  const label      = `Bot-${botIndex}`;
  const isFirstBot = botIndex === 1;

  const baseOptions = {
    forceLogin:     true,
    listenEvents:   true,
    updatePresence: false,
    selfListen:     false,
    online:         true,
    autoMarkRead:   false,
    listenTyping:   false,
  };
  if (api.__deviceManager?.userAgent) {
    baseOptions.userAgent = api.__deviceManager.userAgent;
  }
  api.setOptions(baseOptions);
  console.log(`[LOGIN:${label}] ✅ الاتصال بفيسبوك مستقر`);
  global.botApis.push(api);
  api.__botIndex = botIndex;
  if (isFirstBot) global.botApi = api;
  api.__botName = getBotName(botIndex);
  global._botAdminIds = global._botAdminIds || new Map();
  api.__adminId = global._botAdminIds.get(botIndex) || null;
  (async () => {
    try {
      const uid = api.getCurrentUserID?.();
      if (!uid) return;
      api.__botFbId = String(uid);
      const info = await new Promise((resolve, reject) => {
        api.getUserInfo(uid, (err, res) => (err ? reject(err) : resolve(res)));
      });
      const name = info?.[uid]?.name;
      if (name) {
        api.__botName = name;
        saveBotName(botIndex, name);
        console.log(`[NAME:${label}] 🏷️ الحساب: ${name} (FB ID: ${uid})`);
      }
    } catch (e) {
      console.warn(`[NAME:${label}] ⚠️ تعذّر جلب اسم الحساب:`, e.message);
    }
  })();
  if (typeof attachNexusMethods === "function") {
    try {
      attachNexusMethods(api, api._defaultFuncs, api._ctx);
      console.log(`[NEXUS:${label}] ✅ Nexus methods attached`);
    } catch (e) {
      console.warn(`[NEXUS:${label}] ⚠️ attachNexusMethods فشل:`, e.message);
    }
  }
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
    console.log(`[PERF:${label}] ✅ PerformanceManager جاهز`);
  }
  let _cookieRefresherRef = null;
  if (typeof createCookieRefresher === "function" && api._ctx && api._defaultFuncs) {
    const cookieRefresher = createCookieRefresher({
      intervalMs:     15 * 60 * 1000,   // ★ v2: كل 15 دقيقة (بدلاً من 30)
      backupEnabled:  false,
      appStatePath: null,
      onAppStateUpdate: (state) => saveAppStateForBot(state, botIndex),
    });
    cookieRefresher.attach(api._ctx, api._defaultFuncs);
    _cookieRefresherRef = cookieRefresher;
    api._cookieRefresher = cookieRefresher;
    console.log(`[SESSION:${label}] ✅ CookieRefresher نشط (كل 30 دقيقة)`);
  }
  let sessionGuard = null;
  if (typeof createSessionGuard === "function") {
    sessionGuard = createSessionGuard({
      enabled:            true,
      watchdogIdleMs:     10 * 60 * 1000,
      watchdogIntervalMs: 60_000,
    });
    if (api._ctx) {
      sessionGuard.attach(api._ctx, {
        // ── [FIX #9] onStale يستخدم __forceReconnect بدلاً من startListening() ──
        // startListening() ينشئ closure جديد بكامل timers/متغيرات جديدة مما يُفضي
        // إلى نسخ MQTT/watchdog/sweep متعددة تتراكم مع الزمن.
        // __forceReconnect يُعيد تشغيل اتصال MQTT فقط داخل نفس الـ closure الأصلي.
        onStale: (_ctx) => {
          console.warn(`[SESSION:${label}] ⚠️ الجلسة خاملة منذ 10 دقائق — إعادة اتصال MQTT...`);
          try {
            if (typeof api.__forceReconnect === "function") {
              api.__forceReconnect();
              console.log(`[SESSION:${label}] 🔄 MQTT أُعيد تشغيله بنجاح`);
            }
          } catch (reconnErr) {
            console.error(`[SESSION:${label}] ❌ فشل إعادة الاتصال:`, reconnErr.message);
          }
        },
      });
    }
    api._sessionGuard = sessionGuard;
    if (isFirstBot) global.sessionGuard = sessionGuard;
    console.log(`[SESSION:${label}] ✅ SessionGuard نشط`);
  }

  // ── SessionExtender: تمديد الجلسة الاستباقي ─────────────────────────────
  {
    const extender = createSessionExtender({
      api,
      botIndex,
      cookieRefresher: _cookieRefresherRef,
      sessionGuard,
      checkIntervalMs:     30 * 60 * 1_000,          // ★ v2: فحص كل 30 دقيقة
      refreshThresholdMs:  14 * 24 * 60 * 60 * 1_000, // ★ v2: جدِّد إذا < 14 يوم
      keepAliveIntervalMs:  6 * 60 * 60 * 1_000,       // ★ v2: keep-alive كل 6 ساعات
      onAppStateSave: (state) => saveAppStateForBot(state, botIndex), // ★ v2: حفظ تلقائي
      onExtended: ({ count }) => {
        // احفظ الحالة الجديدة في الذاكرة + MongoDB بعد كل تجديد
        try {
          const refreshed = api.getAppState?.();
          if (refreshed?.length) saveAppStateForBot(refreshed, botIndex);
        } catch (_) {}
        console.log(`[EXTENDER:${label}] 📦 تمديد #${count} — AppState محفوظ في MongoDB`);
      },
    });
    extender.start();
    api._sessionExtender = extender;
    if (isFirstBot) global.sessionExtender = extender;
    console.log(`[EXTENDER:${label}] ✅ SessionExtender نشط (فحص كل 60 دقيقة)`);
  }
  if (typeof StealthMode === "function") {
    api.__stealth = new StealthMode({
      maxRequestsPerMinute: 15,
      dailyRequestLimit:    1200,
      minPauseMinutes:      1,
      maxPauseMinutes:      5,
    });
    console.log(`[STEALTH:${label}] ✅ StealthMode نشط (إيقاع إرسال بشري)`);
  }
  if (typeof attachThreadInfoRealtimeSync === "function" && api._ctx) {
    try {
      attachThreadInfoRealtimeSync(api._ctx, null, null, api);
      console.log(`[SYNC:${label}] ✅ Thread-info realtime sync نشط`);
    } catch (e) {
      console.warn(`[SYNC:${label}] ⚠️ attachThreadInfoRealtimeSync:`, e.message);
    }
  }
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
    api._scheduler = scheduler;
    if (isFirstBot) global.scheduler = scheduler;
    console.log(`[SCHEDULER:${label}] ✅ Scheduler Domain جاهز`);
  }
  botEnhancer();
  const freshState = api.getAppState();
  if (freshState?.length) {
    saveAppStateForBot(freshState, botIndex);
    if (isFirstBot) global.appState = freshState;
  }
  (function scheduleAppStateSave() {
    const delayMs = (30 + Math.random() * 30) * 60 * 1000; // ★ v2: 30–60 دقيقة (بدلاً من 90–150)
    setTimeout(() => {
      try {
        const refreshed = api.getAppState();
        if (refreshed?.length) {
          saveAppStateForBot(refreshed, botIndex);
          if (isFirstBot) global.appState = refreshed;
          sessionGuard?.save();
        }
      } catch (_) {}
      scheduleAppStateSave();
    }, delayMs);
  })();
  startListening(api, botIndex, sessionGuard);
  // E2EE intentionally disabled: only ordinary group events are processed.
  if (isFirstBot) {
    startCleanupInterval();
  }
}

function loginBotWithAppState(account, onFallback) {
  const { state, index } = account;
  const filePath = null;
  const label = `Bot-${index}`;
  const suffix = index === 1 ? "" : String(index);
  console.log(`[LOGIN:${label}] 🔑 تسجيل الدخول بـ AppState (${account.source})...`);
  const sessionLock = new SingleSessionGuard({
    lockPath: path.join(PROJECT_ROOT, `.fca-session${suffix}.lock`),
    staleAfterMs: 60_000,
  });
  if (!sessionLock.acquire()) {
    const msg = `جلسة أخرى تعمل بالفعل بهذا الحساب على هذا الجهاز (session lock) — تم تجاهل محاولة الدخول لتفادي تعارض الجلسات.`;
    console.error(`[LOGIN:${label}] ❌ ${msg}`);
    if (onFallback) onFallback(msg);
    return Promise.reject(new Error(msg));
  }
  return (async () => {
    let loginSucceeded = false;
    try {
      // ── [MONGO RESOLVE] قارن AppState من البيئة مع MongoDB → استخدم الأحدث ──
      let resolvedState = state;
      try {
        const { state: best, source } = await resolveAppState(state, index);
        if (best) {
          resolvedState = best;
          if (source === "mongo") {
            console.log(`[LOGIN:${label}] 🔄 AppState المُحدَّث من MongoDB هو الأحدث — استخدامه`);
          }
        }
      } catch (resolveErr) {
        console.warn(`[LOGIN:${label}] ⚠️ تعذّر المقارنة مع MongoDB: ${resolveErr.message} — استمرار بـ AppState البيئة`);
      }

      const deviceManager = new DeviceManager({
        filePath: path.join(PROJECT_ROOT, `.device-profile${suffix}.json`),
      });
      await deviceManager.init();
      const ctx = await loginAsync({ appState: resolvedState }, { userAgent: deviceManager.userAgent });
      const api = ctx.api;
      api._ctx = ctx;
      // Keep a private per-bot context registry. Some safety/API wrappers hide
      // underscore properties before commands run, so ACP can still access the
      // live fb_dtsg/userID without exposing secrets in events or logs.
      global.__fcaContexts = global.__fcaContexts || new Map();
      global.__fcaContexts.set(index, ctx);
      api.__botIndex = index;
      api.__sessionLock = sessionLock;
      api.__deviceManager = deviceManager;
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
        console.warn(`[LOGIN:${label}] ⚠️ makeDefaults فشل، تم استخدام _request wrapper:`, e.message);
      }
      console.log(`[LOGIN:${label}] ✅ AppState نجح`);
      console.log(`[DEVICE:${label}] 🖥️ بصمة ثابتة: ${deviceManager.deviceId}`);
      loginSucceeded = true;
      try {
        await onBotReady(api, index);
      } catch (e) {
        console.error(`[LOGIN:${label}] ❌ onBotReady فشل:`, e.message);
        sessionLock.release();
        throw e;
      }
    } catch (err) {
      if (!loginSucceeded) sessionLock.release();
      const errMsg = err?.message || String(err);
      if (/checkpoint/i.test(errMsg)) {
        console.log(`[2FA:${label}] ⚡ Checkpoint — أعد إنشاء APPSTATE من جهاز موثوق.`);
      }
      if (onFallback) {
        onFallback(errMsg);
      } else {
        console.error(
          `[LOGIN:${label}] ❌ فشل تسجيل الدخول بـ AppState — هذا الحساب متوقف. ` +
          `تحقق من صلاحية APPSTATE عبر لوحة التحكم ثم أعد التشغيل.`
        );
      }
      throw err;
    }
  })();
}
export {
  PROJECT_ROOT,
  loadAllAppStates,
  saveAppStateForBot,
  loginBotWithAppState,
  onBotReady,
  loadBotNames,
  getBotName,
};
// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-core-client',
  meta: { category: 'core', path: 'src/core/Client.js' },
  setup(_ctx) {
    // provides: PROJECT_ROOT, getBotName, loadAllAppStates, loadBotNames, loginBotWithAppState, onBotReady, saveAppStateForBot
  },
};
