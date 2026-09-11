"use strict";
import fs from "fs-extra";
import path from "path";
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
    console.warn("[BOT-NAME] ⚠️ فشل حفظ اسم الحساب:", e.message);
  }
}
function getBotName(botIndex) {
  return loadBotNames()[String(botIndex)] || null;
}
async function hydrateAppStatesFromVault() {
  if (!appStateVault.isEnabled()) return;
  const rows = await appStateVault.loadAll();
  // Build global adminId map: botIndex -> fbId (used by getUserRole)
  global._botAdminIds = global._botAdminIds || new Map();
  for (const row of rows) {
    if (row.adminFbId) global._botAdminIds.set(row.index, String(row.adminFbId));
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
        // [FIX HYDRATE] نتحقق من أن الملف الحالي ليس أحدث من Postgres
        // لتجنب الكتابة فوق AppState محدَّث من جلسة نشطة بنسخة قديمة من Postgres
        let localIsNewer = false;
        if (fs.existsSync(filePath)) {
          try {
            const localStat = fs.statSync(filePath);
            const pgUpdatedAt = row.updatedAt ? new Date(row.updatedAt).getTime() : 0;
            if (pgUpdatedAt && localStat.mtimeMs > pgUpdatedAt + 30_000) {
              localIsNewer = true;
              console.log(`[APPSTATE-VAULT] ⏭️ appstate${suffix}.json أحدث من Postgres — تم الاحتفاظ بالملف المحلي`);
            }
          } catch (_) {}
        }
        if (!localIsNewer) {
          fs.writeFileSync(filePath, newContent, "utf8");
          try { fs.chmodSync(filePath, 0o600); } catch (_) {}
          console.log(`[APPSTATE-VAULT] ♻️ تحديث appstate${suffix}.json من Postgres`);
        }
      } else {
        console.log(`[APPSTATE-VAULT] ✔️ appstate${suffix}.json محدَّث بالفعل`);
      }
    } catch (e) {
      console.error(`[APPSTATE-VAULT] ❌ فشل استرجاع appstate${suffix}.json:`, e.message);
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
    console.log(`[SESSION] 💾 Bot-${botIndex}: appstate${suffix}.json محفوظ`);
  } catch (err) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
    console.error(`[SESSION] ❌ Bot-${botIndex}: فشل حفظ AppState:`, err.message);
  }
  // [FIX SYNC] رفع AppState إلى Postgres تلقائياً لضمان التزامن
  if (appStateVault.isEnabled()) {
    const botApi = global.botApis?.find(a => a.__botIndex === botIndex);
    const fbId   = botApi?.__botFbId || null;
    const name   = botApi?.__botName || null;
    // نجلب owner الحالي من vault لضمان ظهور AppState لصاحبه في لوحة التحكم
    appStateVault.getOwner(botIndex).then(async (owner) => {
      const resolvedOwner = owner || botApi?.__adminId || "system";
      await appStateVault.saveAppState(botIndex, resolvedOwner, state, name, null, fbId);
    }).catch(e => {
      console.warn(`[SESSION] ⚠️ Bot-${botIndex}: فشل الرفع إلى Postgres:`, e.message);
    });
  }
}
function loadAllAppStates() {
  // [FIX DUPLICATE-SESSION] Read FB ID (c_user) and freshness directly from
  // each appstate file — no login required.
  // For each FB ID, keep only the freshest file; permanently delete all older
  // duplicates from disk AND from Postgres so they never reappear.

  // Helper: extract the FB user ID from a cookie array
  function extractUid(state) {
    if (!Array.isArray(state)) return null;
    const c = state.find((x) => x?.key === "c_user" || x?.name === "c_user");
    return c?.value ? String(c.value) : null;
  }

  // Helper: pick the highest cookie expiry timestamp (Unix seconds).
  // Fields vary by FCA version: "expirationDate" or "expires".
  function extractFreshness(state) {
    if (!Array.isArray(state)) return 0;
    let max = 0;
    for (const c of state) {
      const exp = c?.expirationDate ?? c?.expires ?? 0;
      const ts  = typeof exp === "number" ? exp : parseFloat(exp) || 0;
      if (ts > max) max = ts;
    }
    return max;
  }

  // First pass: collect all readable appstate files
  const candidates = []; // { state, filePath, index, source, uid, freshness }
  for (let i = 1; i <= 20; i++) {
    const suffix   = i === 1 ? "" : String(i);
    const filePath = path.join(PROJECT_ROOT, `appstate${suffix}.json`);
    if (!fs.existsSync(filePath)) continue;
    try {
      const state   = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const uid     = extractUid(state);
      // Cookie expiry = freshness; fall back to file mtime when missing
      let freshness = extractFreshness(state);
      if (!freshness) {
        try { freshness = Math.floor(fs.statSync(filePath).mtimeMs / 1000); } catch (_) {}
      }
      candidates.push({ state, filePath, index: i, source: `appstate${suffix}.json`, uid, freshness });
    } catch (e) {
      console.warn(`[MULTI] ⚠️ appstate${suffix}.json تالف: ${e.message}`);
    }
  }

  // Second pass: per FB ID pick the winner (highest freshness)
  const uidWinner = new Map(); // uid -> winning candidate
  for (const c of candidates) {
    if (!c.uid) continue;
    const prev = uidWinner.get(c.uid);
    if (!prev || c.freshness > prev.freshness) uidWinner.set(c.uid, c);
  }

  // Third pass: delete losers from disk + Postgres, collect winners
  const accounts = [];
  for (const c of candidates) {
    if (!c.uid) {
      // No uid detected — include without dedup
      accounts.push(c);
      console.log(`[MULTI] ✅ وجد ${c.source} → Bot-${c.index} (uid غير معروف)`);
      continue;
    }
    const winner = uidWinner.get(c.uid);
    if (winner.index === c.index) {
      // Freshest file for this FB ID — use it
      accounts.push(c);
      console.log(`[MULTI] ✅ وجد ${c.source} → Bot-${c.index} (uid=${c.uid})`);
    } else {
      // Older duplicate — delete from disk immediately
      console.warn(
        `[MULTI] 🗑️ حذف ${c.source} (uid=${c.uid}) — ` +
        `${winner.source} أحدث منه (freshness=${winner.freshness} > ${c.freshness}).`
      );
      try {
        fs.unlinkSync(c.filePath);
        console.log(`[MULTI] ✅ حُذف ${c.source} من الديسك.`);
      } catch (e) {
        console.warn(`[MULTI] ⚠️ تعذّر حذف ${c.source} من الديسك: ${e.message}`);
      }
      // Delete from Postgres asynchronously (fire-and-forget — non-blocking)
      // We delete by bot_index since owner may vary; use a raw pool query
      // so we don't depend on a specific owner value.
      if (appStateVault.isEnabled()) {
        appStateVault.deleteByIndex(c.index).catch((e) => {
          console.warn(`[MULTI] ⚠️ تعذّر حذف Bot-${c.index} من Postgres: ${e.message}`);
        });
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
  if (typeof api.getThreadList === "function") {
    const sweepPendingInboxes = async () => {
      // [FIX] تحقق أن هذا البوت لا يزال نشطاً قبل الاستدعاء
      // إذا أُزيل من global.botApis (بعد حذف الجلسة من لوحة التحكم) نوقف المسح تلقائياً
      if (!global.botApis?.includes(api)) {
        api.__stopSweep?.();
        return;
      }
      try {
        for (const tag of ["PENDING", "OTHER"]) {
          let list;
          try { list = await api.getThreadList(30, null, [tag]); }
          catch (e) {
            const msg = e?.message || (typeof e === "object" ? JSON.stringify(e) : String(e));
            console.warn(`[PENDING] ⚠️ getThreadList(${tag}) فشل: ${msg}`);
            continue;
          }
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
                  console.warn(
                    `[PENDING] ⚠️ batch accept error (${isPermanent ? "permanent – skip" : "transient – will retry"}): ${safeStringify(err)}`
                  );
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
        console.warn(`[PENDING] ⚠️ sweep error: ${safeStringify(e)}`);
      }
    };
    // [FIX] تخزين مرجع المؤقت على api حتى يمكن إلغاؤه عند حذف الجلسة
    let _sweepTimer = null;
    api.__stopSweep = () => {
      if (_sweepTimer) { clearTimeout(_sweepTimer); _sweepTimer = null; }
    };
    // تأخير أوّلي عشوائي (15–40 ثانية) لتجنب الإطلاق المتزامن مع عمليات الـ login
    _sweepTimer = setTimeout(function doSweepLoop() {
      sweepPendingInboxes().finally(() => {
        // [FIX] لا نُجدول دورة جديدة إذا أُوقف المسح (بعد حذف البوت من الذاكرة)
        if (!api.__stopSweep) return;
        // فترة عشوائية بين 4 و8 دقائق بين كل مسح وآخر
        const nextMs = (4 + Math.random() * 4) * 60 * 1000;
        _sweepTimer = setTimeout(doSweepLoop, nextMs);
      });
    }, 15_000 + Math.random() * 25_000);
  }
  // [FIX THREADS] نحتفظ بـ _acceptedThreads خارج listen() حتى لا تُفقد عند إعادة الاتصال
  const _acceptedThreads = api._acceptedThreads || (api._acceptedThreads = new Set());

  // ── MQTT Watchdog ──────────────────────────────────────────────────────────
  // listenMqtt dies silently on network blips, FB server resets, or platform
  // sleep (Render free tier). The watchdog tracks the last-event timestamp and
  // re-calls listen() whenever silence exceeds DEAD_THRESHOLD_MS.
  // A liveness ping resets the clock during genuinely quiet periods so we
  // don't reconnect just because no users sent messages.
  const DEAD_THRESHOLD_MS = 4 * 60 * 1000;       // 4 min silence → suspect dead
  const WATCHDOG_TICK_MS  = 60 * 1000;            // check every 1 min
  const PING_INTERVAL_MS  = 2 * 60 * 1000;        // liveness ping every 2 min
  const MAX_RECONNECTS    = 10;                    // circuit-breaker ceiling
  const RECONNECT_BACKOFF = [5, 10, 20, 30, 60];  // backoff steps in seconds

  let _lastEventAt    = Date.now();
  let _reconnectCount = 0;
  let _listening      = false; // guard: only one listenMqtt active at a time
  let _watchdogTimer  = null;
  let _pingTimer      = null;

  const listen = () => {
    if (_listening) return;
    _listening = true;
    api.listenMqtt(async (err, event) => {
      if (err) {
        console.error(`[MQTT:${label}] خطأ:`, err.message || err);
        // Let the watchdog decide when to reconnect — don't stack connections here
        _listening = false;
        return;
      }
      // Successful event: reset dead-clock and reconnect counter
      _lastEventAt    = Date.now();
      _reconnectCount = 0;
      botSessionGuard?.heartbeat();
      // [PAUSE-GATE] Keep MQTT alive but drop events while paused
      if (global._pausedBots?.has(botIndex)) return;
      try {
        dispatchMqttEvent(api, event, label, _acceptedThreads);
      } catch (e) { console.error(`[EVENT ERR:${label}]`, e.message); }
    });
  };

  // Liveness ping: getCurrentUserID is synchronous (reads in-memory session)
  // so it doesn't make a network call, but confirms the api object is alive.
  // We reset _lastEventAt here to prevent false watchdog fires during quiet
  // periods when no users are sending messages.
  const startPing = () => {
    _pingTimer = setInterval(() => {
      try {
        if (api.getCurrentUserID?.()) _lastEventAt = Date.now();
      } catch (_) { /* session gone — watchdog will catch it */ }
    }, PING_INTERVAL_MS);
  };

  // Watchdog tick: reconnects when silence exceeds the dead threshold.
  // Uses exponential backoff and a circuit-breaker to avoid infinite loops.
  const startWatchdog = () => {
    _watchdogTimer = setInterval(async () => {
      const silenceMs = Date.now() - _lastEventAt;
      if (silenceMs < DEAD_THRESHOLD_MS) return; // still alive — do nothing

      if (_reconnectCount >= MAX_RECONNECTS) {
        console.error(
          `[WATCHDOG:${label}] ❌ وصل لحد ${MAX_RECONNECTS} محاولة — توقّف. أعد تشغيل الخدمة يدوياً.`
        );
        clearInterval(_watchdogTimer);
        clearInterval(_pingTimer);
        return;
      }

      const backoffSec = RECONNECT_BACKOFF[Math.min(_reconnectCount, RECONNECT_BACKOFF.length - 1)];
      _reconnectCount++;

      console.warn(
        `[WATCHDOG:${label}] ⚠️ صمت ${Math.round(silenceMs / 1000)}ث — ` +
        `إعادة اتصال #${_reconnectCount} بعد ${backoffSec}ث...`
      );

      await new Promise(r => setTimeout(r, backoffSec * 1000));

      _lastEventAt = Date.now(); // reset before reconnect to avoid double-fire
      _listening   = false;      // allow listen() to proceed
      listen();
      console.log(`[WATCHDOG:${label}] 🔄 أُعيد تشغيل MQTT (محاولة #${_reconnectCount}).`);
    }, WATCHDOG_TICK_MS);
  };

  // Expose stop/restart handles so pause/resume can control the watchdog
  api.__stopWatchdog = () => {
    clearInterval(_watchdogTimer);
    clearInterval(_pingTimer);
    _watchdogTimer = null;
    _pingTimer     = null;
    _listening     = false;
    console.log(`[WATCHDOG:${label}] ⏸ watchdog أُوقف (إيقاف مؤقت).`);
  };
  api.__restartWatchdog = () => {
    // Guard: don't stack timers if already running
    if (_watchdogTimer || _pingTimer) return;
    _lastEventAt    = Date.now(); // reset so we don't reconnect immediately
    _reconnectCount = 0;
    startPing();
    startWatchdog();
    console.log(`[WATCHDOG:${label}] ▶ watchdog أُعيد تشغيله (استئناف).`);
  };

  listen();
  startPing();
  startWatchdog();
  console.log(
    `[SUCCESS] ${label} يستمع عبر MQTT... ` +
    `(watchdog نشط — عتبة ${DEAD_THRESHOLD_MS / 60000} دقيقة، backoff حتى ${RECONNECT_BACKOFF.at(-1)}ث)`
  );
  // ── end watchdog ────────────────────────────────────────────────────────────
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
  console.log(`[LOGIN:${label}] ✅ الاتصال بفيسبوك مستقر`);
  global.botApis.push(api);
  api.__botIndex = botIndex;
  if (isFirstBot) global.botApi = api;
  api.__botName = getBotName(botIndex);
  // Hydrate per-bot admin ID (set by dashboard user, stored in Postgres/file)
  global._botAdminIds = global._botAdminIds || new Map();
  api.__adminId = global._botAdminIds.get(botIndex) || null;
  (async () => {
    try {
      const uid = api.getCurrentUserID?.();
      if (!uid) return;
      // bot_fb_id already set above; just sync to vault
      api.__botFbId = String(uid);
      appStateVault.updateBotFbId(botIndex, uid).catch(() => {});
      const info = await new Promise((resolve, reject) => {
        api.getUserInfo(uid, (err, res) => (err ? reject(err) : resolve(res)));
      });
      const name = info?.[uid]?.name;
      if (name) {
        api.__botName = name;
        saveBotName(botIndex, name);
        appStateVault.updateBotName(botIndex, name).catch(() => {});
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
  if (typeof createCookieRefresher === "function" && api._ctx && api._defaultFuncs) {
    const cookieRefresher = createCookieRefresher({
      intervalMs:     30 * 60 * 1000,
      expiryDays:     60,
      backupEnabled:  false,
      appStatePath:   appStatePath || path.join(PROJECT_ROOT, `appstate${botIndex === 1 ? "" : botIndex}.json`),
    });
    cookieRefresher.attach(api._ctx, api._defaultFuncs);
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
        onStale: (_ctx) => {
          console.warn(`[SESSION:${label}] ⚠️ الجلسة خاملة منذ 10 دقائق — إعادة تشغيل MQTT...`);
          // [FIX SESSION] نُعيد استخدام نفس دالة startListening مع نفس botSessionGuard
          // لتجنب تداخل الجلسات وضياع _acceptedThreads المُجمَّعة
          try {
            startListening(api, botIndex, sessionGuard, null);
            console.log(`[SESSION:${label}] 🔄 MQTT أُعيد تشغيله بنجاح`);
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
        console.warn(`[LOGIN:${label}] ⚠️ makeDefaults فشل، تم استخدام _request wrapper:`, e.message);
      }
      console.log(`[LOGIN:${label}] ✅ AppState نجح`);
      console.log(`[DEVICE:${label}] 🖥️ بصمة ثابتة: ${deviceManager.deviceId}`);
      // نُعلّم النجاح قبل onBotReady حتى لا يُحرَّر القفل إذا فشلت onBotReady بعد الاتصال
      loginSucceeded = true;
      try {
        onBotReady(api, index, filePath, dbReadyPromise);
      } catch (e) {
        console.error(`[LOGIN:${label}] ❌ onBotReady فشل:`, e.message);
        sessionLock.release();
        throw e;
      }
    } catch (err) {
      // نُحرِّر القفل فقط عند الفشل — onBotReady تُسنده إلى api.__sessionLock وتتولى تحريره عند SIGTERM
      if (!loginSucceeded) sessionLock.release();
      const errMsg = err?.message || String(err);
      if (/checkpoint/i.test(errMsg)) {
        console.log(`[2FA:${label}] ⚡ Checkpoint — أعد إنشاء appstate${suffix}.json من جهاز موثوق.`);
      }
      if (onFallback) {
        onFallback(errMsg);
      } else {
        console.error(
          `[LOGIN:${label}] ❌ فشل تسجيل الدخول بـ AppState — هذا الحساب متوقف. ` +
          `تحقق من صلاحية appstate${suffix}.json عبر لوحة التحكم ثم أعد التشغيل.`
        );
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
// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-core-client',
  meta: { category: 'core', path: 'src/core/Client.js' },
  setup(_ctx) {
    // provides: PROJECT_ROOT, getBotName, hydrateAppStatesFromVault, loadAllAppStates, loadBotNames, loginBotWithAppState, onBotReady, saveAppStateForBot
  },
};
