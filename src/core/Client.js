"use strict";
import fs from "fs-extra";
import path from "path";
import chalk from "chalk";
import botEnhancer from "../utils/bot-enhancer.js";
import cache from "../utils/cache.js";
import { dispatchMqttEvent } from "../events/onMessage.js";
import { startCleanupInterval } from "../events/onReady.js";
import * as appStateVault from "../db/postgres.js";
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
    console.warn(chalk.yellow("[BOT-NAME] ⚠️ فشل حفظ اسم الحساب:"), e.message);
  }
}
function getBotName(botIndex) {
  return loadBotNames()[String(botIndex)] || null;
}
async function hydrateAppStatesFromVault() {
  if (!appStateVault.isEnabled()) return;
  const rows = await appStateVault.loadAll();
  for (const row of rows) {
    const suffix = row.index === 1 ? "" : String(row.index);
    const filePath = path.join(PROJECT_ROOT, `appstate${suffix}.json`);
    // ✅ نكتب دائماً من Postgres (المصدر الأحدث) بغض النظر عن وجود الملف على الديسك
    // هذا يضمن أن إعادة التشغيل تستخدم AppState المحدَّث وليس القديم
    try {
      const newContent = JSON.stringify(row.state, null, 2);
      // مقارنة المحتوى لتجنب الكتابة غير الضرورية
      let needsWrite = true;
      if (fs.existsSync(filePath)) {
        try {
          const existing = fs.readFileSync(filePath, "utf8");
          needsWrite = existing.trim() !== newContent.trim();
        } catch (_) {}
      }
      if (needsWrite) {
        fs.writeFileSync(filePath, newContent, "utf8");
        try { fs.chmodSync(filePath, 0o600); } catch (_) {}
        console.log(chalk.cyan(`[APPSTATE-VAULT] ♻️ تحديث appstate${suffix}.json من Postgres (الأحدث)`));
      } else {
        console.log(chalk.gray(`[APPSTATE-VAULT] ✔️ appstate${suffix}.json محدَّث بالفعل`));
      }
    } catch (e) {
      console.error(chalk.red(`[APPSTATE-VAULT] ❌ فشل استرجاع appstate${suffix}.json:`), e.message);
    }
    if (row.botName) saveBotName(row.index, row.botName);
  }
}
function saveAppStateForBot(state, botIndex) {
  const suffix   = botIndex === 1 ? "" : String(botIndex);
  const filePath = path.join(PROJECT_ROOT, `appstate${suffix}.json`);
  const tmpPath  = filePath + ".tmp";
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf8");
    try { fs.chmodSync(tmpPath, 0o600); } catch (_) {}
    fs.renameSync(tmpPath, filePath);
    console.log(chalk.green(`[SESSION] 💾 Bot-${botIndex}: appstate${suffix}.json محفوظ`));
  } catch (err) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
    console.error(chalk.red(`[SESSION] ❌ Bot-${botIndex}: فشل حفظ AppState:`, err.message));
  }
}
function loadAllAppStates() {
  const accounts = [];
  for (let i = 1; i <= 20; i++) {
    const suffix = i === 1 ? "" : String(i);
    const filePath = path.join(PROJECT_ROOT, `appstate${suffix}.json`);
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
  return accounts;
}
function safeStringify(v) {
  if (v instanceof Error) return v.stack || v.message;
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}
function startListening(api, botIndex, botSessionGuard, dbReadyPromise) {
  const label = `Bot-${botIndex}`;
  const sweptThreads = new Set();
  if (botIndex === 1 && typeof api.getThreadList === "function") {
    const sweepPendingInboxes = async () => {
      try {
        for (const tag of ["PENDING", "OTHER"]) {
          let list;
          try { list = await api.getThreadList(30, null, [tag]); } catch { continue; }
          if (!Array.isArray(list) || list.length === 0) continue;
          const ids = list.map(t => t.threadID).filter(Boolean).filter(id => !sweptThreads.has(id));
          if (ids.length === 0) continue;
          for (let i = 0; i < ids.length; i += 10) {
            const batch = ids.slice(i, i + 10);
            await new Promise(res => {
              api.handleMessageRequest(batch, true, err => {
                if (err) {
                  const errCode = err?.error_code || err?.code || 0;
                  // [FIX P3] نميّز بين أخطاء نهائية وأخطاء مؤقتة:
                  // 1357031 = "request already handled" → نهائي، نُضيف للمجموعة
                  // أخطاء الشبكة → مؤقتة، لا نُضيف حتى تُعاد المحاولة في الدورة التالية
                  const isPermanent = errCode === 1357031 || /already handled/i.test(err?.message || "");
                  if (isPermanent) {
                    batch.forEach(id => sweptThreads.add(id));
                  }
                  console.warn(chalk.yellow(
                    `[PENDING] ⚠️ batch accept error (${isPermanent ? "permanent – skip" : "transient – will retry"}): ${safeStringify(err)}`
                  ));
                } else {
                  // نجاح: نُضيف لمنع المعالجة المزدوجة
                  batch.forEach(id => sweptThreads.add(id));
                }
                res();
              });
            });
          }
        }
      } catch (e) {
        console.warn(chalk.yellow(`[PENDING] ⚠️ sweep error: ${safeStringify(e)}`));
      }
    };
    // تأخير أوّلي عشوائي (15–40 ثانية) لتجنب الإطلاق المتزامن مع عمليات الـ login
    setTimeout(function doSweepLoop() {
      sweepPendingInboxes().finally(() => {
        // فترة عشوائية بين 4 و8 دقائق بين كل مسح وآخر
        const nextMs = (4 + Math.random() * 4) * 60 * 1000;
        setTimeout(doSweepLoop, nextMs);
      });
    }, 15_000 + Math.random() * 25_000);
  }
  const listen = () => {
    const _acceptedThreads = new Set();
    api.listenMqtt(async (err, event) => {
      if (err) {
        console.error(chalk.red(`[MQTT:${label}] خطأ:`), err.message || err);
        return;
      }
      botSessionGuard?.heartbeat();
      try {
        dispatchMqttEvent(api, event, label, _acceptedThreads);
      } catch (e) { console.error(`[EVENT ERR:${label}]`, e.message); }
    });
  };
  listen();
  console.log(chalk.green(`[SUCCESS] ${label} يستمع عبر MQTT...`));
  (async () => {
    if (dbReadyPromise) { try { await dbReadyPromise; } catch (_) {} }
  })();
}
function onBotReady(api, botIndex, appStatePath, dbReadyPromise) {
  const label      = `Bot-${botIndex}`;
  const isFirstBot = botIndex === 1;
  // لا نحدد userAgent يدوياً هنا — FCA's DeviceManager هو المرجع الوحيد
  // أي تجاوز يدوي يُنشئ UA مختلف عن رؤوس Sec-Ch-Ua التي أرسلها FCA أثناء الـ login
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
  console.log(chalk.green(`[LOGIN:${label}] ✅ الاتصال بفيسبوك مستقر`));
  global.botApis.push(api);
  api.__botIndex = botIndex;
  if (isFirstBot) global.botApi = api;
  api.__botName = getBotName(botIndex);
  (async () => {
    try {
      const uid = api.getCurrentUserID?.();
      if (!uid) return;
      const info = await new Promise((resolve, reject) => {
        api.getUserInfo(uid, (err, res) => (err ? reject(err) : resolve(res)));
      });
      const name = info?.[uid]?.name;
      if (name) {
        api.__botName = name;
        saveBotName(botIndex, name);
        appStateVault.updateBotName(botIndex, name).catch(() => {});
        console.log(chalk.cyan(`[NAME:${label}] 🏷️ الحساب: ${name}`));
      }
    } catch (e) {
      console.warn(chalk.yellow(`[NAME:${label}] ⚠️ تعذّر جلب اسم الحساب:`), e.message);
    }
  })();
  if (typeof attachNexusMethods === "function") {
    try {
      attachNexusMethods(api, api._defaultFuncs, api._ctx);
      console.log(chalk.cyan(`[NEXUS:${label}] ✅ Nexus methods attached`));
    } catch (e) {
      console.warn(chalk.yellow(`[NEXUS:${label}] ⚠️ attachNexusMethods فشل:`), e.message);
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
    console.log(chalk.cyan(`[PERF:${label}] ✅ PerformanceManager جاهز`));
  }
  if (typeof createCookieRefresher === "function" && api._ctx && api._defaultFuncs) {
    const cookieRefresher = createCookieRefresher({
      intervalMs:     30 * 60 * 1000,
      expiryDays:     60,
      backupEnabled:  false,
      appStatePath:   appStatePath || path.join(PROJECT_ROOT, `appstate${botIndex === 1 ? "" : botIndex}.json`),
    });
    cookieRefresher.attach(api._ctx, api._defaultFuncs);
    console.log(chalk.cyan(`[SESSION:${label}] ✅ CookieRefresher نشط (كل 30 دقيقة)`));
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
        onStale: (_ctx) => {
          console.warn(chalk.yellow(`[SESSION:${label}] ⚠️ الجلسة خاملة منذ 10 دقائق — قد يكون MQTT توقف.`));
        },
      });
    }
    api._sessionGuard = sessionGuard;
    if (isFirstBot) global.sessionGuard = sessionGuard;
    console.log(chalk.cyan(`[SESSION:${label}] ✅ SessionGuard نشط`));
  }
  if (typeof StealthMode === "function") {
    api.__stealth = new StealthMode({
      maxRequestsPerMinute: 15,
      dailyRequestLimit:    1200,
      minPauseMinutes:      1,
      maxPauseMinutes:      5,
    });
    console.log(chalk.cyan(`[STEALTH:${label}] ✅ StealthMode نشط (إيقاع إرسال بشري)`));
  }
  if (typeof attachThreadInfoRealtimeSync === "function" && api._ctx) {
    try {
      attachThreadInfoRealtimeSync(api._ctx, null, null, api);
      console.log(chalk.cyan(`[SYNC:${label}] ✅ Thread-info realtime sync نشط`));
    } catch (e) {
      console.warn(chalk.yellow(`[SYNC:${label}] ⚠️ attachThreadInfoRealtimeSync:`), e.message);
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
    console.log(chalk.cyan(`[SCHEDULER:${label}] ✅ Scheduler Domain جاهز`));
  }
  botEnhancer(); // [FIX P1] لا يحتاج api بعد الآن — idempotent، يعمل مرة واحدة فقط
  const freshState = api.getAppState();
  if (freshState?.length) {
    saveAppStateForBot(freshState, botIndex);
    if (isFirstBot) global.appState = freshState;
  }
  // حفظ AppState بفترة عشوائية (90–150 دقيقة) بدون log ثابت
  // FCA's createCookieRefresher يعالج التحديث الشبكي كل 30 دقيقة — هذا للنسخ الاحتياطي المحلي فقط
  (function scheduleAppStateSave() {
    const delayMs = (90 + Math.random() * 60) * 60 * 1000;
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
  startListening(api, botIndex, sessionGuard, dbReadyPromise);
  if (isFirstBot) {
    startCleanupInterval();
  }

}
function loginBotWithAppState(account, onFallback, dbReadyPromise) {
  // [FIX P2] نُعيد Promise حتى يستطيع المستدعي معرفة نتيجة الدخول
  const { state, filePath, index } = account;
  const label = `Bot-${index}`;
  const suffix = index === 1 ? "" : String(index);
  console.log(chalk.blue(`[LOGIN:${label}] 🔑 تسجيل الدخول بـ AppState (${account.source})...`));
  const sessionLock = new SingleSessionGuard({
    lockPath: path.join(PROJECT_ROOT, `.fca-session${suffix}.lock`),
    staleAfterMs: 60_000,
  });
  if (!sessionLock.acquire()) {
    const msg = `جلسة أخرى تعمل بالفعل بهذا الحساب على هذا الجهاز (session lock) — تم تجاهل محاولة الدخول لتفادي تعارض الجلسات.`;
    console.error(chalk.red(`[LOGIN:${label}] ❌ ${msg}`));
    if (onFallback) onFallback(msg);
    return Promise.reject(new Error(msg));
  }
  return (async () => {
    try {
      const deviceManager = new DeviceManager({
        filePath: path.join(PROJECT_ROOT, `.device-profile${suffix}.json`),
      });
      await deviceManager.init();
      const ctx = await loginAsync({ appState: state }, { userAgent: deviceManager.userAgent });
      const api = ctx.api;
      api._ctx = ctx;
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
        console.warn(chalk.yellow(`[LOGIN:${label}] ⚠️ makeDefaults فشل، تم استخدام _request wrapper:`, e.message));
      }
      console.log(chalk.green(`[LOGIN:${label}] ✅ AppState نجح`));
      console.log(chalk.cyan(`[DEVICE:${label}] 🖥️ بصمة ثابتة: ${deviceManager.deviceId}`));
      onBotReady(api, index, filePath, dbReadyPromise);
    } catch (err) {
      sessionLock.release();
      const errMsg = err?.message || String(err);
      if (/checkpoint/i.test(errMsg)) {
        console.log(chalk.yellow(`[2FA:${label}] ⚡ Checkpoint — أعد إنشاء appstate${suffix}.json من جهاز موثوق.`));
      }
      if (onFallback) {
        onFallback(errMsg);
      } else {
        console.error(chalk.red(
          `[LOGIN:${label}] ❌ فشل تسجيل الدخول بـ AppState — هذا الحساب متوقف. ` +
          `تحقق من صلاحية appstate${suffix}.json عبر لوحة التحكم ثم أعد التشغيل.`
        ));
      }
      throw err; // نُعيد الرفع حتى يصل إلى Promise.allSettled
    }
  })();
}
export {
  PROJECT_ROOT,
  loadAllAppStates,
  hydrateAppStatesFromVault,
  saveAppStateForBot,
  loginBotWithAppState,
  onBotReady,
  loadBotNames,
  getBotName,
};
