"use strict";
/**
 * appStatePersist.js — v2.0
 * ─────────────────────────────────────────────────────────────────────────────
 * حفظ AppState في MongoDB واسترجاعه عند بدء التشغيل.
 *
 * التحسينات في v2.0:
 *  - رُفعت عتبة التحذير من 7 → 14 يوم (اكتشاف مبكر)
 *  - REQUIRED_COOKIES مُوسَّعة: نتحقق أيضاً من fr لأنه المؤشر الرئيسي
 *    للنشاط البشري عند Facebook
 *  - دعم حفظ timestamp آخر keep-alive لمراقبة صحة الجلسة
 */

import { bugLog }           from "./runtimeEnv.js";
import { AppStateModel }    from "../db/schemas.js";

// ── ثوابت ────────────────────────────────────────────────────────────────────

/**
 * عتبة التحذير: أقل من 14 يوم → الجلسة "تقترب من الانتهاء"
 * (كانت 7 أيام — رُفعت لاكتشاف المشكلة أبكر وإعطاء وقت كافٍ للتجديد)
 */
export const EXPIRY_WARNING_MS = 14 * 24 * 60 * 60 * 1_000;

/** الكوكيز الإلزامية لصحة AppState */
const REQUIRED_COOKIES = ["c_user", "xs"];

/** الكوكيز المُوصى بفحصها للتحذير المبكر (غير إلزامية للـ validation) */
const MONITORED_COOKIES = ["c_user", "xs", "fr", "sb", "datr"];

// ── الحفظ في MongoDB ──────────────────────────────────────────────────────────

/**
 * يحفظ (أو يُحدِّث) AppState في MongoDB.
 *
 * @param {Array}          state
 * @param {number|string}  botIndex
 * @param {string}         [source="runtime"]
 * @returns {Promise<boolean>}
 */
export async function saveAppStateToMongo(state, botIndex = 1, source = "runtime") {
  if (!_isMongoBound()) {
    bugLog("APPSTATE_MONGO", "MongoDB غير متصل — تخطي الحفظ");
    return false;
  }
  if (!_validateAppState(state)) {
    console.warn(`[APPSTATE] ⚠️ AppState غير صالح — تخطي الحفظ في MongoDB`);
    return false;
  }

  try {
    await AppStateModel.findOneAndUpdate(
      { botIndex: Number(botIndex) },
      {
        $set: {
          appState:    state,
          savedAt:     new Date(),
          source,
          cookieCount: state.length,
          // سجِّل تاريخ آخر عملية keep-alive للمراقبة
          lastActivity: source.startsWith("keep-alive") ? new Date() : undefined,
        },
      },
      { upsert: true, new: true }
    );
    bugLog("APPSTATE_MONGO", "AppState saved", { botIndex, cookieCount: state.length, source });
    console.log(`[APPSTATE] 🍃 حُفظ في MongoDB (${state.length} cookie | ${source}) — Bot-${botIndex}`);
    return true;
  } catch (err) {
    console.warn(`[APPSTATE] ⚠️ فشل الحفظ في MongoDB: ${err.message}`);
    return false;
  }
}

// ── التحميل من MongoDB ────────────────────────────────────────────────────────

/**
 * يقرأ أحدث AppState مخزَّن في MongoDB لهذا botIndex.
 *
 * @param {number|string} botIndex
 * @returns {Promise<{ appState: Array, savedAt: Date, source: string } | null>}
 */
export async function loadAppStateFromMongo(botIndex = 1) {
  if (!_isMongoBound()) return null;

  try {
    const doc = await AppStateModel
      .findOne({ botIndex: Number(botIndex) })
      .lean();

    if (!doc?.appState || !_validateAppState(doc.appState)) return null;

    console.log(
      `[APPSTATE] 🍃 تم تحميل AppState من MongoDB` +
      ` (${doc.appState.length} cookie، محفوظ: ${doc.savedAt?.toISOString() ?? "?"})`
    );
    return {
      appState: doc.appState,
      savedAt:  doc.savedAt ?? new Date(0),
      source:   doc.source  ?? "mongo",
    };
  } catch (err) {
    console.warn(`[APPSTATE] ⚠️ فشل تحميل AppState من MongoDB: ${err.message}`);
    return null;
  }
}

// ── المقارنة وتحديد الأحدث ────────────────────────────────────────────────────

/**
 * يقارن AppState من البيئة (env) مع MongoDB ويُعيد الأحدث.
 *
 * @param {Array|null}     envState
 * @param {number|string}  botIndex
 * @returns {Promise<{ state: Array, source: "env"|"mongo"|null }>}
 */
export async function resolveAppState(envState, botIndex = 1) {
  const mongoDoc = await loadAppStateFromMongo(botIndex);

  if (!envState && !mongoDoc) {
    console.error("[APPSTATE] ❌ لا يوجد AppState لا في البيئة ولا في MongoDB");
    return { state: null, source: null };
  }

  if (!mongoDoc) {
    console.log("[APPSTATE] 🔑 استخدام AppState من متغير البيئة (لا يوجد سجل MongoDB)");
    return { state: envState, source: "env" };
  }

  if (!envState) {
    console.log("[APPSTATE] 🔑 استخدام AppState من MongoDB (متغير البيئة فارغ)");
    _syncEnvFromMongo(mongoDoc.appState);
    return { state: mongoDoc.appState, source: "mongo" };
  }

  const processStartMs = Date.now() - Math.round(process.uptime() * 1_000);
  const mongoSavedMs   = mongoDoc.savedAt instanceof Date
    ? mongoDoc.savedAt.getTime()
    : new Date(mongoDoc.savedAt).getTime();

  if (mongoSavedMs > processStartMs) {
    const diffMin = Math.round((mongoSavedMs - processStartMs) / 60_000);
    console.log(
      `[APPSTATE] 🔄 MongoDB أحدث بـ ${diffMin} دقيقة من إقلاع العملية` +
      ` — استخدام جلسة MongoDB (Bot-${botIndex})`
    );
    _syncEnvFromMongo(mongoDoc.appState);
    return { state: mongoDoc.appState, source: "mongo" };
  }

  console.log("[APPSTATE] 🔑 متغير البيئة هو الأحدث — استخدامه");
  return { state: envState, source: "env" };
}

// ── فحص انتهاء الصلاحية ──────────────────────────────────────────────────────

/**
 * يفحص إذا كانت أي كوكيز AppState تقترب من الانتهاء.
 * v2.0: يُعيد أيضاً قائمة بالكوكيز التي ستنتهي للمراقبة.
 *
 * @param {Array}  appState
 * @param {number} [warningMs=EXPIRY_WARNING_MS]
 * @returns {{ expiring: boolean, minTtlMs: number, expiresAt: Date|null, expiringSoon: string[] }}
 */
export function checkAppStateExpiry(appState, warningMs = EXPIRY_WARNING_MS) {
  if (!Array.isArray(appState)) {
    return { expiring: false, minTtlMs: Infinity, expiresAt: null, expiringSoon: [] };
  }

  const now         = Date.now();
  let   minTtl      = Infinity;
  let   minExp      = null;
  const expiringSoon = [];

  for (const cookie of appState) {
    const name = String(cookie?.key ?? cookie?.name ?? "");
    const exp  = cookie?.expires;

    if (!exp || exp === "Infinity" || exp === Infinity) continue;

    const expMs = exp instanceof Date  ? exp.getTime()
                : typeof exp === "string" ? new Date(exp).getTime()
                : typeof exp === "number"
                  ? (exp < 1e12 ? exp * 1_000 : exp)
                : NaN;

    if (isNaN(expMs) || expMs <= 0) continue;

    const ttl = expMs - now;
    if (ttl < minTtl) { minTtl = ttl; minExp = new Date(expMs); }

    // سجِّل الكوكيز ذات الأولوية التي تنتهي قريباً
    if (ttl < warningMs && MONITORED_COOKIES.includes(name)) {
      expiringSoon.push(`${name}(${Math.round(ttl / 86_400_000)}d)`);
    }
  }

  if (expiringSoon.length > 0) {
    console.warn(`[APPSTATE] ⏰ كوكيز تقترب من الانتهاء: ${expiringSoon.join(", ")}`);
  }

  return {
    expiring:     minTtl < warningMs,
    minTtlMs:     minTtl === Infinity ? Infinity : Math.max(0, minTtl),
    expiresAt:    minExp,
    expiringSoon,
  };
}

// ── داخلي ─────────────────────────────────────────────────────────────────────

function _isMongoBound() {
  return !!(global.db);
}

function _syncEnvFromMongo(state) {
  try {
    process.env.APPSTATE  = JSON.stringify(state);
    globalThis.appState   = state;
    bugLog("APPSTATE_MONGO", "Synced env from MongoDB", { cookieCount: state.length });
  } catch (e) {
    console.warn(`[APPSTATE] ⚠️ فشل مزامنة البيئة من MongoDB: ${e.message}`);
  }
}

function _validateAppState(state) {
  if (!Array.isArray(state) || state.length === 0) return false;
  const keys = new Set(state.map(c => String(c?.key ?? c?.name ?? "")));
  return REQUIRED_COOKIES.every(k => keys.has(k));
}
