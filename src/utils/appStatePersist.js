"use strict";
/**
 * appStatePersist.js — بدون قاعدة بيانات
 * ─────────────────────────────────────────
 * يعتمد فقط على متغيرات البيئة (APPSTATE).
 * جميع دوال MongoDB أُزيلت — البوت يعمل بدون DB.
 */

export const EXPIRY_WARNING_MS = 14 * 24 * 60 * 60 * 1_000;

const REQUIRED_COOKIES = ["c_user", "xs"];
const MONITORED_COOKIES = ["c_user", "xs", "fr", "sb", "datr"];

/** دائماً false — لا Mongo */
export async function saveAppStateToMongo(_state, _botIndex = 1, _source = "runtime") {
  return false;
}

/** دائماً null — لا Mongo */
export async function loadAppStateFromMongo(_botIndex = 1) {
  return null;
}

/**
 * يُحدِّد AppState الذي سيُستخدم — من البيئة فقط.
 */
export async function resolveAppState(envState, _botIndex = 1) {
  if (_validateAppState(envState)) {
    return { state: envState, source: "env" };
  }
  console.error("[APPSTATE] ❌ لا يوجد AppState صالح في متغيرات البيئة");
  return { state: null, source: null };
}

/**
 * يفحص إذا كانت أي كوكيز تقترب من الانتهاء.
 */
export function checkAppStateExpiry(appState, warningMs = EXPIRY_WARNING_MS) {
  if (!Array.isArray(appState)) {
    return { expiring: false, minTtlMs: Infinity, expiresAt: null, expiringSoon: [] };
  }
  const now = Date.now();
  let minTtl = Infinity, minExp = null;
  const expiringSoon = [];

  for (const cookie of appState) {
    const name = String(cookie?.key ?? cookie?.name ?? "");
    const exp  = cookie?.expires;
    if (!exp || exp === "Infinity" || exp === Infinity) continue;

    const expMs =
      exp instanceof Date       ? exp.getTime()
      : typeof exp === "string" ? new Date(exp).getTime()
      : typeof exp === "number" ? (exp < 1e12 ? exp * 1_000 : exp)
      : NaN;

    if (isNaN(expMs) || expMs <= 0) continue;
    const ttl = expMs - now;
    if (ttl < minTtl) { minTtl = ttl; minExp = new Date(expMs); }
    if (ttl < warningMs && MONITORED_COOKIES.includes(name)) {
      expiringSoon.push(`${name}(${Math.round(ttl / 86_400_000)}d)`);
    }
  }

  if (expiringSoon.length > 0) {
    console.warn(`[APPSTATE] ⏰ كوكيز تقترب من الانتهاء: ${expiringSoon.join(", ")}`);
  }
  return {
    expiring:    minTtl < warningMs,
    minTtlMs:    minTtl === Infinity ? Infinity : Math.max(0, minTtl),
    expiresAt:   minExp,
    expiringSoon,
  };
}

function _validateAppState(state) {
  if (!Array.isArray(state) || state.length === 0) return false;
  const keys = new Set(state.map((c) => String(c?.key ?? c?.name ?? "")));
  return REQUIRED_COOKIES.every((k) => keys.has(k));
}
