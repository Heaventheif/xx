"use strict";
/**
 * src/core/Client.js — fca-nx
 * ────────────────────────────
 * يستخدم fca-nx (CommonJS) عبر createRequire.
 */

import fs   from "fs-extra";
import path from "path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const fcaNx   = require("fca-nx");
const login   = fcaNx.login ?? fcaNx.default ?? fcaNx;

import { readAppStateFromEnv, updateAppStateInMemory } from "../utils/runtimeEnv.js";
import { dispatchMqttEvent }    from "../events/onMessage.js";
import { startCleanupInterval } from "../events/onReady.js";
import { createMqttConnectionManager } from "./MqttConnectionManager.js";
import { initBotLifecycle }    from "./bot-init.js";

export const PROJECT_ROOT = path.join(import.meta.dir, "..", "..");

// ── أسماء البوتات ────────────────────────────────────────────────────────────
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
  } catch (_) {}
}

export function getBotName(botIndex) {
  return loadBotNames()[String(botIndex)] || null;
}

// ── AppState ──────────────────────────────────────────────────────────────────
export function loadAllAppStates() {
  const state = readAppStateFromEnv();
  if (!state) return [];
  return [{ state, index: 1, source: "APPSTATE" }];
}

export function saveAppStateForBot(state, botIndex = 1, source = "runtime") {
  try {
    if (!Array.isArray(state) || state.length === 0) throw new Error("فارغ");
    const keys = new Set(state.map(c => String(c?.key ?? c?.name ?? "")));
    if (!keys.has("c_user") || !keys.has("xs")) throw new Error("cookies ناقصة");
    updateAppStateInMemory(state);
    console.log(`[APPSTATE] ✅ تحديث في الذاكرة (${state.length} cookie | Bot-${botIndex})`);
    return true;
  } catch (err) {
    console.warn(`[APPSTATE] ⚠️ ${err.message}`);
    return false;
  }
}

// ── خيارات fca-nx العامة ─────────────────────────────────────────────────────
const GLOBAL_OPTIONS = {
  selfListen:      false,
  listenEvents:    true,
  forceLogin:      true,
  autoMarkRead:    false,
  updatePresence:  false,
  online:          true,
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/127.0.0.0 Safari/537.36",
};

// ── تسجيل الدخول ─────────────────────────────────────────────────────────────
export function loginBotWithAppState(account, onFallback) {
  const { state, index } = account;
  const label = `Bot-${index}`;

  console.log(`[LOGIN:${label}] 🔑 تسجيل الدخول بـ AppState...`);

  return new Promise((resolve, reject) => {
    login({ appState: state }, GLOBAL_OPTIONS, async (err, api) => {
      if (err) {
        const msg = err?.error || err?.message || String(err);
        console.error(`[LOGIN:${label}] ❌ فشل: ${msg}`);
        if (/checkpoint/i.test(msg))
          console.log(`[2FA:${label}] ⚡ أعد إنشاء APPSTATE من متصفح موثوق`);
        onFallback?.(msg);
        return reject(new Error(msg));
      }

      console.log(`[LOGIN:${label}] ✅ AppState نجح`);

      try {
        await initBotLifecycle(api, index, {
          saveAppState:                saveAppStateForBot,
          onMqttEvent:                 (event, _api, threads) =>
            dispatchMqttEvent(_api, event, label, threads),
          onFirstBotReady:             () => startCleanupInterval(),
          getBotName,
          saveBotName,
          createMqttConnectionManager,
        });
        resolve(api);
      } catch (e) {
        console.error(`[BOT:${label}] ❌ خطأ في التهيئة:`, e.message);
        reject(e);
      }
    });
  });
}

export { loadBotNames };
