"use strict";
/**
 * Client.js — نسخة مُخففة
 * ──────────────────────────────────────────────────────────────
 * مسؤولية هذا الملف فقط:
 *   1. قراءة AppState من البيئة
 *   2. تسجيل الدخول عبر fca-unofficial
 *   3. توليد بصمة جهاز جديدة في كل اتصال (rotateOnStart)
 *   4. استدعاء initBotLifecycle من fca-unofficial
 *
 * كل منطق onBotReady / MQTT / Session انتقل إلى:
 *   fca-unofficial/lib/app/bot-init.js
 */

import fs   from "fs-extra";
import path from "path";

import { readAppStateFromEnv, updateAppStateInMemory } from "../utils/runtimeEnv.js";
import { dispatchMqttEvent }   from "../events/onMessage.js";
import { startCleanupInterval } from "../events/onReady.js";
import { createMqttConnectionManager } from "./MqttConnectionManager.js";

import * as fcaModule from "fca-unofficial";

const {
  loginAsync,
  DeviceManager,
  SingleSessionGuard,
  SessionManager,
  FileStorage,
  initBotLifecycle,         // ← من fca-unofficial/lib/app/bot-init.js
} = fcaModule;

if (typeof Bun === "undefined") {
  console.error("[FATAL] هذا البوت يتطلب Bun — https://bun.sh");
  process.exit(1);
}

export const PROJECT_ROOT = path.join(import.meta.dir, "..", "..");

// ── makeDefaults lazy ─────────────────────────────────────────────────────────
let _makeDefaultsFn = null;
async function getMakeDefaults() {
  if (_makeDefaultsFn) return _makeDefaultsFn;
  try {
    const mod = await import("fca-unofficial/lib/utils/request/defaults.js");
    _makeDefaultsFn = mod.makeDefaults ?? mod.default?.makeDefaults ?? null;
  } catch { _makeDefaultsFn = null; }
  return _makeDefaultsFn;
}

// ── أسماء البوتات (ملف محلي) ─────────────────────────────────────────────────
const BOT_NAMES_FILE = path.join(PROJECT_ROOT, "botNames.json");

function loadBotNames() {
  try {
    if (fs.existsSync(BOT_NAMES_FILE))
      return JSON.parse(fs.readFileSync(BOT_NAMES_FILE, "utf8")) || {};
  } catch (_) {}
  return {};
}

function saveBotName(botIndex, name) {
  if (!name) return;
  try {
    const all = loadBotNames();
    all[String(botIndex)] = name;
    const tmp = BOT_NAMES_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2), "utf8");
    fs.renameSync(tmp, BOT_NAMES_FILE);
  } catch (e) {
    console.warn("[BOT-NAME] ⚠️ فشل حفظ اسم الحساب:", e.message);
  }
}

export function getBotName(botIndex) {
  return loadBotNames()[String(botIndex)] || null;
}

// ── AppState ──────────────────────────────────────────────────────────────────
export function loadAllAppStates() {
  const state = readAppStateFromEnv();
  if (!state) return [];
  return [{ state, filePath: null, index: 1, source: "APPSTATE", uid: null, freshness: Date.now() }];
}

export function saveAppStateForBot(state, botIndex = 1, source = "runtime") {
  try {
    if (!Array.isArray(state) || state.length === 0)
      throw new Error("AppState فارغ");
    const keys = new Set(state.map((c) => String(c?.key ?? c?.name ?? "")));
    if (!keys.has("c_user") || !keys.has("xs"))
      throw new Error("AppState يفتقد cookies أساسية");

    updateAppStateInMemory(state);
    console.log(`[APPSTATE] ✅ تحديث في الذاكرة (${state.length} cookie | Bot-${botIndex})`);
    return true;
  } catch (err) {
    console.warn(`[APPSTATE] ⚠️ ${err.message}`);
    return false;
  }
}

// ── تسجيل الدخول ─────────────────────────────────────────────────────────────
export function loginBotWithAppState(account, onFallback) {
  const { state, index } = account;
  const label  = `Bot-${index}`;
  const suffix = index === 1 ? "" : String(index);

  console.log(`[LOGIN:${label}] 🔑 تسجيل الدخول بـ AppState (${account.source})...`);

  const sessionLock = new SingleSessionGuard({
    lockPath:     path.join(PROJECT_ROOT, `.fca-session${suffix}.lock`),
    staleAfterMs: 60_000,
  });

  if (!sessionLock.acquire()) {
    const msg = "جلسة أخرى تعمل بالفعل — تم تجاهل محاولة الدخول لتفادي تعارض الجلسات.";
    console.error(`[LOGIN:${label}] ❌ ${msg}`);
    onFallback?.(msg);
    return Promise.reject(new Error(msg));
  }

  return (async () => {
    let loginSucceeded = false;
    try {

      // ── بصمة جديدة في كل اتصال (rotateOnStart: true) ────────────────────
      const deviceManager = new DeviceManager({
        filePath:      path.join(PROJECT_ROOT, `.device-profile${suffix}.json`),
        rotateOnStart: true,   // 🔄 بصمة عشوائية جديدة عند كل تشغيل
      });
      await deviceManager.init();
      console.log(`[DEVICE:${label}] 🔄 بصمة جديدة: ${deviceManager.deviceId.slice(0, 12)}…`);

      // ── تسجيل الدخول ──────────────────────────────────────────────────────
      const ctx = await loginAsync(
        { appState: state },
        { userAgent: deviceManager.userAgent }
      );
      const api  = ctx.api;
      api._ctx   = ctx;

      // ربط بصمة الجهاز بالسياق
      ctx._stealthProfile = {
        id:                 "rotating",
        userAgent:          deviceManager.userAgent,
        secChUa:            deviceManager.profile?.secChUa ?? "",
        secChUaPlatform:    deviceManager.profile?.secChUaPlatform ?? "",
        acceptLanguage:     "en-US,en;q=0.9",
        isFirefox:          false,
      };

      // تخزين في global
      global.__fcaContexts = global.__fcaContexts || new Map();
      global.__fcaContexts.set(index, ctx);
      api.__botIndex     = index;
      api.__sessionLock  = sessionLock;
      api.__deviceManager = deviceManager;

      // ── defaultFuncs ───────────────────────────────────────────────────────
      try {
        const makeDefaults = await getMakeDefaults();
        if (makeDefaults && ctx.jar && (ctx.userID || ctx.fbid)) {
          api._defaultFuncs = makeDefaults("", ctx.userID || ctx.fbid, ctx);
        }
      } catch (e) {
        console.warn(`[LOGIN:${label}] ⚠️ makeDefaults فشل:`, e.message);
      }

      // ── SessionManager (حفظ محلي مشفّر اختياري) ─────────────────────────
      const sessionPath = path.join(PROJECT_ROOT, `.session${suffix}.json`);
      const finalUID    = String(api.getCurrentUserID?.() || "unknown");
      const sessionMgr  = new SessionManager({
        userID:  finalUID,
        storage: new FileStorage(sessionPath, { secret: process.env.FCA_SESSION_KEY }),
      });
      api._sessionMgr = sessionMgr;

      try {
        await sessionMgr.save(api, { label: "post-login", trigger: "boot" });
        console.log(`[SESSION:${label}] 🔐 AppState محفوظ محلياً`);
      } catch (e) {
        // FCA_SESSION_KEY غير مضبوط — طبيعي في بيئة Render
        if (!process.env.FCA_SESSION_KEY) {
          console.log(`[SESSION:${label}] ℹ️ FCA_SESSION_KEY غير مضبوط — الجلسة في الذاكرة فقط`);
        } else {
          console.warn(`[SESSION:${label}] ⚠️ تعذّر حفظ الجلسة: ${e.message}`);
        }
      }

      console.log(`[LOGIN:${label}] ✅ AppState نجح`);
      loginSucceeded = true;

      // ── تهيئة حياة البوت (MQTT / SessionGuard / Stealth …) ───────────────
      //    كل هذا في fca-unofficial/lib/app/bot-init.js
      await initBotLifecycle(api, index, {
        saveAppState:                saveAppStateForBot,
        onMqttEvent:                 (event, _api, threads) =>
          dispatchMqttEvent(_api, event, label, threads),
        onFirstBotReady:             () => startCleanupInterval(),
        getBotName,
        saveBotName,
        createMqttConnectionManager,   // ← يُمرَّر مباشرة بدلاً من import داخلي
      });

    } catch (err) {
      if (!loginSucceeded) sessionLock.release();
      const errMsg = err?.message || String(err);
      if (/checkpoint/i.test(errMsg)) {
        console.log(`[2FA:${label}] ⚡ Checkpoint — أعد إنشاء APPSTATE من جهاز موثوق.`);
      }
      if (onFallback) {
        onFallback(errMsg);
      } else {
        console.error(`[LOGIN:${label}] ❌ فشل تسجيل الدخول — تحقق من صلاحية APPSTATE.`);
      }
      throw err;
    }
  })();
}

export { loadBotNames };

export const $plugin = {
  name:  "xx-core-client",
  meta:  { category: "core", path: "src/core/Client.js" },
  setup: (_ctx) => {},
};
