"use strict";
/**
 * bot-init.js  — fca-unofficial/lib/app/bot-init.js
 * ─────────────────────────────────────────────────
 * دوال إعداد البوت بعد تسجيل الدخول.
 * نُقلت من src/core/Client.js إلى هنا لإبقاء Client.js نظيفاً.
 *
 * التصدير:
 *   startMqttListener(api, opts)   — يشغّل مدير MQTT
 *   initBotLifecycle(api, idx, opts) — يعادل onBotReady السابق
 */

import { EventEmitter } from "node:events";
import {
  attachNexusMethods,
  getGlobalPerformanceManager,
  createCookieRefresher,
  createSessionGuard,
  attachThreadInfoRealtimeSync,
  createSchedulerDomain,
  StealthMode,
} from "../index.js";

// ── MqttConnectionManager يُستورَد بشكل lazy لتفادي التبعيات الدائرية ─────────
let _mqttManagerFactory = null;
async function getMqttManagerFactory() {
  if (_mqttManagerFactory) return _mqttManagerFactory;
  try {
    // من fca-unofficial/lib/app/ → ../../../src/core/
    const mod = await import("../../../src/core/MqttConnectionManager.js").catch(
      () => import("../transport/MqttConnectionManager.js").catch(() => null)
    );
    _mqttManagerFactory = mod?.createMqttConnectionManager ?? null;
  } catch {
    _mqttManagerFactory = null;
  }
  return _mqttManagerFactory;
}

// ── SessionExtender يُستورَد بشكل lazy ────────────────────────────────────────
let _sessionExtenderFactory = null;
async function getSessionExtenderFactory() {
  if (_sessionExtenderFactory) return _sessionExtenderFactory;
  try {
    // من fca-unofficial/lib/app/ → ../../../src/safety/
    const mod = await import("../../../src/safety/session-extender.js").catch(() => null);
    _sessionExtenderFactory = mod?.createSessionExtender ?? null;
  } catch {
    _sessionExtenderFactory = null;
  }
  return _sessionExtenderFactory;
}

// ── botEnhancer يُستورَد بشكل lazy ────────────────────────────────────────────
let _botEnhancer = null;
async function getBotEnhancer() {
  if (_botEnhancer) return _botEnhancer;
  try {
    // من fca-unofficial/lib/app/ → ../../../src/utils/
    const mod = await import("../../../src/utils/bot-enhancer.js").catch(() => null);
    _botEnhancer = mod?.default ?? null;
  } catch {
    _botEnhancer = null;
  }
  return _botEnhancer;
}

// ────────────────────────────────────────────────────────────────────────────
// startMqttListener
// ────────────────────────────────────────────────────────────────────────────
/**
 * يُشغّل مدير MQTT المرن ويربطه بالـ api.
 *
 * @param {object} api
 * @param {{
 *   label:        string,
 *   botIndex:     number,
 *   sessionGuard: object|null,
 *   onEvent:      (event: object) => void,
 * }} opts
 */
export async function startMqttListener(api, opts = {}) {
  const { label, botIndex, sessionGuard, onEvent } = opts;

  if (api.__mqttManager) {
    console.warn(`[MQTT:${label}] manager موجود؛ طلب إعادة اتصال single-flight.`);
    return api.__mqttManager.reconnect("duplicate_start");
  }

  const createMqttConnectionManager = await getMqttManagerFactory();
  if (!createMqttConnectionManager) {
    console.error(`[MQTT:${label}] ❌ لم يُعثر على MqttConnectionManager`);
    return null;
  }

  const acceptedThreads = api._acceptedThreads || (api._acceptedThreads = new Set());

  const manager = createMqttConnectionManager(api, {
    label,
    botIndex,
    onState: (health) => {
      api.__mqttHealth = health;
      global._mqttHealthByBot = global._mqttHealthByBot || new Map();
      global._mqttHealthByBot.set(botIndex, health);
      if (health.state === "CONNECTED") sessionGuard?.heartbeat();
    },
    onEvent: (event) => {
      sessionGuard?.heartbeat();
      if (global._pausedBots?.has(botIndex)) return;
      try {
        onEvent?.(event, api, acceptedThreads);
      } catch (err) {
        console.error(`[EVENT ERR:${label}]`, err.message || err);
      }
    },
  });

  api.__mqttManager   = manager;
  api.__forceReconnect = (reason = "manual") => manager.reconnect(reason);
  api.__stopWatchdog   = () => manager.stop();
  api.__restartWatchdog = () => manager.start();
  api.__mqttHealth     = manager.health();

  manager.on("ping_ok",    () => sessionGuard?.heartbeat());
  manager.on("auth_failed", (h) => {
    console.error(`[MQTT:${label}] AppState مرفوض.`, h.lastError || "auth failed");
  });
  manager.on("cooldown", (h) => {
    console.warn(`[MQTT:${label}] دخل cooldown حتى ${h.cooldownUntil}`);
  });

  manager.start();
  console.log(`[SUCCESS] ${label} مدير MQTT مرن نشط.`);
  return manager;
}

// ────────────────────────────────────────────────────────────────────────────
// initBotLifecycle  (كان: onBotReady)
// ────────────────────────────────────────────────────────────────────────────
/**
 * يُعدّ كل مكونات البوت بعد نجاح تسجيل الدخول.
 *
 * @param {object} api
 * @param {number} botIndex
 * @param {{
 *   saveAppState:    (state: Array, idx: number, src: string) => void,
 *   onMqttEvent:     (event, api, threads) => void,
 *   onFirstBotReady: () => void,
 *   getBotName:      (idx: number) => string|null,
 *   saveBotName:     (idx: number, name: string) => void,
 * }} opts
 */
export async function initBotLifecycle(api, botIndex, opts = {}) {
  const {
    saveAppState   = () => {},
    onMqttEvent    = () => {},
    onFirstBotReady = () => {},
    getBotName     = () => null,
    saveBotName    = () => {},
  } = opts;

  const label      = `Bot-${botIndex}`;
  const isFirstBot = botIndex === 1;

  // ── حياة الدورة ─────────────────────────────────────────────────────────
  api.__lifecycleStopped    = false;
  api.__stopSessionLifecycle = async () => {
    if (api.__lifecycleStopped) return;
    api.__lifecycleStopped = true;
    clearTimeout(api.__appStateSaveTimer);
    api.__appStateSaveTimer = null;
    try { api._sessionExtender?.stop(); } catch (_) {}
    try { api._cookieRefresher?.stop(); } catch (_) {}
    try { api._sessionGuard?.stop();    } catch (_) {}
    try { await api.__mqttManager?.stop(); } catch (_) {}
  };

  // ── الخيارات الأساسية ────────────────────────────────────────────────────
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

  // ── تسجيل في global ──────────────────────────────────────────────────────
  global.botApis.push(api);
  api.__botIndex = botIndex;
  if (isFirstBot) global.botApi = api;
  api.__botName = getBotName(botIndex);

  global._botAdminIds = global._botAdminIds || new Map();
  api.__adminId = global._botAdminIds.get(botIndex) || null;

  // ── جلب اسم الحساب ──────────────────────────────────────────────────────
  ;(async () => {
    try {
      const uid = api.getCurrentUserID?.();
      if (!uid) return;
      api.__botFbId = String(uid);
      const info = await new Promise((res, rej) =>
        api.getUserInfo(uid, (err, r) => (err ? rej(err) : res(r)))
      );
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

  // ── Nexus ────────────────────────────────────────────────────────────────
  if (typeof attachNexusMethods === "function") {
    try {
      attachNexusMethods(api, api._defaultFuncs, api._ctx);
      console.log(`[NEXUS:${label}] ✅ Nexus methods attached`);
    } catch (e) {
      console.warn(`[NEXUS:${label}] ⚠️ attachNexusMethods فشل:`, e.message);
    }
  }

  // ── PerformanceManager ───────────────────────────────────────────────────
  if (typeof getGlobalPerformanceManager === "function") {
    try {
      const perfMgr = getGlobalPerformanceManager({
        enableCache: true, cacheSize: 2000, cacheTTL: 10 * 60 * 1000,
        enableMetrics: true, gcIntervalMs: 5 * 60 * 1000,
      });
      if (isFirstBot) global.perfManager = perfMgr;
      console.log(`[PERF:${label}] ✅ PerformanceManager جاهز`);
    } catch (_) {}
  }

  // ── CookieRefresher (opt-in فقط) ─────────────────────────────────────────
  let _cookieRefresherRef = null;
  if (typeof createCookieRefresher === "function" && api._ctx && api._defaultFuncs) {
    const refresher = createCookieRefresher({
      enabled:          false,
      intervalMs:       60 * 60 * 1000,
      backupEnabled:    false,
      appStatePath:     null,
      onAppStateUpdate: (s) => saveAppState(s, botIndex, "cookie-refresh"),
    });
    refresher.attach(api._ctx, api._defaultFuncs);
    _cookieRefresherRef  = refresher;
    api._cookieRefresher = refresher;
    console.log(`[SESSION:${label}] ✅ CookieRefresher جاهز عند الحاجة فقط`);
  }

  // ── SessionGuard ─────────────────────────────────────────────────────────
  let sessionGuard = null;
  if (typeof createSessionGuard === "function") {
    sessionGuard = createSessionGuard({
      enabled:            true,
      watchdogIdleMs:     30 * 60 * 1000,
      watchdogIntervalMs: 60_000,
    });
    if (api._ctx) {
      sessionGuard.attach(api._ctx, {
        onStale: () => console.warn(`[SESSION:${label}] ⚠️ لا نشاط منذ 30 دقيقة.`),
      });
    }
    api._sessionGuard = sessionGuard;
    if (isFirstBot) global.sessionGuard = sessionGuard;
    console.log(`[SESSION:${label}] ✅ SessionGuard نشط`);
  }

  // ── SessionExtender ───────────────────────────────────────────────────────
  const createSessionExtender = await getSessionExtenderFactory();
  if (typeof createSessionExtender === "function") {
    const extender = createSessionExtender({
      api,
      botIndex,
      cookieRefresher:     _cookieRefresherRef,
      sessionGuard,
      checkIntervalMs:     6 * 60 * 60 * 1_000,
      refreshThresholdMs:  14 * 24 * 60 * 60 * 1_000,
      keepAliveIntervalMs: 24 * 60 * 60 * 1_000,
      onAppStateSave:      (s) => saveAppState(s, botIndex, "keep-alive"),
      onExtended: ({ count }) => {
        try {
          const refreshed = api.getAppState?.();
          if (refreshed?.length) saveAppState(refreshed, botIndex, "extended");
        } catch (_) {}
        console.log(`[EXTENDER:${label}] 📦 تمديد #${count}`);
      },
    });
    extender.start();
    api._sessionExtender = extender;
    if (isFirstBot) global.sessionExtender = extender;
    console.log(`[EXTENDER:${label}] ✅ SessionExtender نشط`);
  }

  // ── StealthMode ───────────────────────────────────────────────────────────
  if (typeof StealthMode === "function") {
    api.__stealth = new StealthMode({
      maxRequestsPerMinute: 15,
      dailyRequestLimit:    1200,
      minPauseMinutes:      1,
      maxPauseMinutes:      5,
    });
    console.log(`[STEALTH:${label}] ✅ StealthMode نشط`);
  }

  // ── Thread-info realtime sync ─────────────────────────────────────────────
  if (typeof attachThreadInfoRealtimeSync === "function" && api._ctx) {
    try {
      attachThreadInfoRealtimeSync(api._ctx, null, null, api);
      console.log(`[SYNC:${label}] ✅ Thread-info realtime sync نشط`);
    } catch (e) {
      console.warn(`[SYNC:${label}] ⚠️`, e.message);
    }
  }

  // ── Scheduler ────────────────────────────────────────────────────────────
  if (typeof createSchedulerDomain === "function") {
    const scheduler = createSchedulerDomain({
      sendMessage: (msg, tid, cb, replyID) =>
        new Promise((res, rej) => {
          global.safeSend(api, msg, tid, (err, info) => {
            if (err) { rej(err); cb?.(err); }
            else     { res(info); cb?.(null, info); }
          }, replyID);
        }),
    });
    api._scheduler = scheduler;
    if (isFirstBot) global.scheduler = scheduler;
    console.log(`[SCHEDULER:${label}] ✅ Scheduler Domain جاهز`);
  }

  // ── botEnhancer ───────────────────────────────────────────────────────────
  const botEnhancer = await getBotEnhancer();
  botEnhancer?.();

  // ── حفظ AppState الطازج ───────────────────────────────────────────────────
  const freshState = api.getAppState?.();
  if (freshState?.length) {
    saveAppState(freshState, botIndex, "post-login");
    if (isFirstBot) global.appState = freshState;
  }

  // ── دورة الحفظ الدورية (كل ~60-120 دقيقة) ───────────────────────────────
  ;(function scheduleAppStateSave() {
    const delayMs = (60 + Math.random() * 60) * 60 * 1000;
    api.__appStateSaveTimer = setTimeout(() => {
      try {
        const refreshed = api.getAppState?.();
        if (refreshed?.length) {
          saveAppState(refreshed, botIndex, "scheduled");
          if (isFirstBot) global.appState = refreshed;
          sessionGuard?.save();
        }
      } catch (_) {}
      if (!api.__lifecycleStopped) scheduleAppStateSave();
    }, delayMs);
    api.__appStateSaveTimer.unref?.();
  })();

  // ── MQTT ──────────────────────────────────────────────────────────────────
  await startMqttListener(api, {
    label,
    botIndex,
    sessionGuard,
    onEvent: onMqttEvent,
  });

  // ── أول بوت جاهز ─────────────────────────────────────────────────────────
  if (isFirstBot) onFirstBotReady();
}
