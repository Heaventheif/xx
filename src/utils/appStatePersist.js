"use strict";
/**
 * appStatePersist.js
 * ─────────────────────────────────────────────────────────────────────────────
 * حفظ AppState في MongoDB واسترجاعه عند بدء التشغيل.
 *
 * لماذا MongoDB وليس القرص؟
 *  - يعمل مع منصات Serverless/Ephemeral (Render, Railway, Heroku…) التي لا تضمن
 *    بقاء الملفات بين عمليات إعادة النشر.
 *  - نسخة واحدة مركزية يمكن الوصول إليها من أي instance.
 *  - تاريخ التعديل موثَّق (createdAt / updatedAt) عبر Mongoose timestamps.
 *
 * الخوارزمية عند الإقلاع:
 *   1. اقرأ AppState من متغير البيئة (APPSTATE).
 *   2. اقرأ AppState من MongoDB (آخر سجل لهذا botIndex).
 *   3. قارن savedAt للاثنين → استخدم الأحدث.
 *   4. إذا فاز MongoDB → حدِّث process.env.APPSTATE بقيمته (لضمان الاتساق).
 *
 * الاستخدام في Client.js:
 *   import { saveAppStateToMongo, resolveAppState, checkAppStateExpiry }
 *     from "../utils/appStatePersist.js";
 */

import { bugLog }      from "./runtimeEnv.js";
import { AppStateModel } from "../db/schemas.js";

// ── ثوابت ────────────────────────────────────────────────────────────────────

/** عتبة التحذير: أقل من 7 أيام → الجلسة "تقترب من الانتهاء" */
export const EXPIRY_WARNING_MS = 7 * 24 * 60 * 60 * 1_000;

/** الكوكيز الإلزامية لصحة AppState */
const REQUIRED_COOKIES = ["c_user", "xs"];

// ── الحفظ في MongoDB ──────────────────────────────────────────────────────────

/**
 * يحفظ (أو يُحدِّث) AppState في MongoDB.
 * يستخدم upsert → دائماً سجل واحد لكل botIndex.
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
          appState: state,
          savedAt:  new Date(),
          source,
        },
      },
      { upsert: true, new: true }
    );
    bugLog("APPSTATE_MONGO", "AppState saved", { botIndex, cookieCount: state.length });
    console.log(`[APPSTATE] 🍃 حُفظ في MongoDB (${state.length} cookie) — Bot-${botIndex}`);
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
    return { appState: doc.appState, savedAt: doc.savedAt ?? new Date(0), source: doc.source ?? "mongo" };
  } catch (err) {
    console.warn(`[APPSTATE] ⚠️ فشل تحميل AppState من MongoDB: ${err.message}`);
    return null;
  }
}

// ── المقارنة وتحديد الأحدث ────────────────────────────────────────────────────

/**
 * يقارن AppState من البيئة (env) مع MongoDB ويُعيد الأحدث.
 * إذا فاز MongoDB → يُحدِّث process.env.APPSTATE تلقائياً للاتساق.
 *
 * @param {Array|null}     envState   - AppState المحمَّل من process.env
 * @param {number|string}  botIndex
 * @returns {Promise<{ state: Array, source: "env"|"mongo"|null }>}
 */
export async function resolveAppState(envState, botIndex = 1) {
  const mongoDoc = await loadAppStateFromMongo(botIndex);

  // لا شيء على الإطلاق
  if (!envState && !mongoDoc) {
    console.error("[APPSTATE] ❌ لا يوجد AppState لا في البيئة ولا في MongoDB");
    return { state: null, source: null };
  }

  // فقط البيئة
  if (!mongoDoc) {
    console.log("[APPSTATE] 🔑 استخدام AppState من متغير البيئة (لا يوجد سجل MongoDB)");
    return { state: envState, source: "env" };
  }

  // فقط MongoDB
  if (!envState) {
    console.log("[APPSTATE] 🔑 استخدام AppState من MongoDB (متغير البيئة فارغ)");
    _syncEnvFromMongo(mongoDoc.appState);
    return { state: mongoDoc.appState, source: "mongo" };
  }

  // كلاهما موجود → قارن بـ savedAt
  // نعتبر mongoDoc.savedAt أحدث إذا كانت أكبر من وقت إقلاع العملية
  // (أي تم تحديث MongoDB من نسخة سابقة لهذه العملية)
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
 *
 * @param {Array}  appState
 * @param {number} [warningMs=EXPIRY_WARNING_MS]
 * @returns {{ expiring: boolean, minTtlMs: number, expiresAt: Date|null }}
 */
export function checkAppStateExpiry(appState, warningMs = EXPIRY_WARNING_MS) {
  if (!Array.isArray(appState)) return { expiring: false, minTtlMs: Infinity, expiresAt: null };

  const now  = Date.now();
  let minTtl = Infinity;
  let minExp = null;

  for (const cookie of appState) {
    const exp = cookie?.expires;
    if (!exp || exp === "Infinity" || exp === Infinity) continue;

    const expMs = exp instanceof Date ? exp.getTime()
                : typeof exp === "string" ? new Date(exp).getTime()
                : typeof exp === "number"
                  ? (exp < 1e12 ? exp * 1_000 : exp) // Unix-seconds vs ms
                : NaN;

    if (isNaN(expMs) || expMs <= 0) continue;

    const ttl = expMs - now;
    if (ttl < minTtl) { minTtl = ttl; minExp = new Date(expMs); }
  }

  return {
    expiring:  minTtl < warningMs,
    minTtlMs:  minTtl === Infinity ? Infinity : Math.max(0, minTtl),
    expiresAt: minExp,
  };
}

// ── داخلي ─────────────────────────────────────────────────────────────────────

/** يتحقق من أن Mongoose متصل */
function _isMongoBound() {
  return !!(global.db);
}

/** يُحدِّث process.env.APPSTATE من قيمة MongoDB لضمان الاتساق */
function _syncEnvFromMongo(state) {
  try {
    process.env.APPSTATE  = JSON.stringify(state);
    globalThis.appState   = state;
    bugLog("APPSTATE_MONGO", "Synced env from MongoDB", { cookieCount: state.length });
  } catch (e) {
    console.warn(`[APPSTATE] ⚠️ فشل مزامنة البيئة من MongoDB: ${e.message}`);
  }
}

/** يتحقق من صحة AppState */
function _validateAppState(state) {
  if (!Array.isArray(state) || state.length === 0) return false;
  const keys = new Set(state.map(c => String(c?.key ?? c?.name ?? "")));
  return REQUIRED_COOKIES.every(k => keys.has(k));
}
