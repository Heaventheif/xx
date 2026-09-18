"use strict";
/**
 * appStatePersist.js — v2.1
 * ─────────────────────────────────────────────────────────────────────────────
 * حفظ AppState في MongoDB واسترجاعه عند بدء التشغيل.
 *
 * التغييرات في v2.1:
 *  - [NEW] `resolveAppState` يكتب الحالة الفائزة إلى MongoDB دائماً، حتى لو
 *    فازت البيئة. هذا يجعل "آخر حالة معروفة صالحة" متاحة عند إقلاع لاحق
 *    بدون متغير بيئة.
 *  - [NEW] فحص حجم `state.length` — تحذير إذا تجاوز 90 كوكي (تلوّث محتمل).
 *  - [NEW] `lastActivity` يُسجَّل في MongoDB عند كل keep-alive ناجح.
 *
 * ملاحظات:
 *  - عتبة التحذير 14 يوم (EXPIRY_WARNING_MS).
 *  - MONITORED_COOKIES = [c_user, xs, fr, sb, datr] لأغراض المراقبة فقط،
 *    ليست شرطاً للحفظ.
 */

import { bugLog }        from "./runtimeEnv.js";
import { AppStateModel } from "../db/schemas.js";
import {
  canWriteBackup,
  decryptBackupString,
  encryptBackupString,
} from "../../fca-unofficial/lib/safety/backup-crypto.js";

// ── ثوابت ────────────────────────────────────────────────────────────────────

/**
 * عتبة التحذير: أقل من 14 يوم → الجلسة "تقترب من الانتهاء"
 */
export const EXPIRY_WARNING_MS = 14 * 24 * 60 * 60 * 1_000;

/** الكوكيز الإلزامية لصحة AppState */
const REQUIRED_COOKIES = ["c_user", "xs"];

/** الكوكيز المُوصى بفحصها للتحذير المبكر (غير إلزامية للـ validation) */
const MONITORED_COOKIES = ["c_user", "xs", "fr", "sb", "datr"];

/** حد التحذير لحجم AppState */
const MAX_EXPECTED_COOKIES = 90;

// ── الحفظ في MongoDB ─────────────────────────────────────────────────────────

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
    console.warn("[APPSTATE] ⚠️ AppState غير صالح — تخطي الحفظ في MongoDB");
    return false;
  }
  const serialized = JSON.stringify(state);
  if (Buffer.byteLength(serialized, "utf8") > 250_000) {
    console.warn("[APPSTATE] ⚠️ AppState أكبر من الحد المسموح (250KB) — تم رفض الحفظ");
    return false;
  }
  if (!canWriteBackup((message, level = "warn") => {
    const fn = level === "error" ? console.error : console.warn;
    fn(message);
  })) {
    return false;
  }

  // حماية من تلوّث الحالة (cookies من حسابات مختلطة).
  if (state.length > MAX_EXPECTED_COOKIES) {
    console.warn(
      `[APPSTATE] ⚠️ الحالة تحتوي ${state.length} كوكي — العدد أكبر من المتوقع ` +
      `(~20-40). تحقّق من عدم اختلاط حسابات.`
    );
  }

  try {
    await AppStateModel.findOneAndUpdate(
      { botIndex: Number(botIndex) },
      {
        $set: {
          // AppState contains live Facebook session cookies. MongoDB must
          // never receive the array in plaintext.
          appState:     encryptBackupString(serialized),
          savedAt:      new Date(),
          source,
          cookieCount:  state.length,
          // نُسجّل lastActivity فقط عند عمليات keep-alive، حتى يبقى حقل
          // "آخر عملية نشطة" ذا معنى (وليس "آخر عملية حفظ").
          ...(source.startsWith("keep-alive")
            ? { lastActivity: new Date() }
            : {}),
        },
      },
      { upsert: true, returnDocument: "after" }
    );

    bugLog("APPSTATE_MONGO", "AppState saved", {
      botIndex,
      cookieCount: state.length,
      source,
    });
    console.log(
      `[APPSTATE] 🍃 حُفظ في MongoDB (${state.length} cookie | ${source}) — Bot-${botIndex}`
    );
    return true;
  } catch (err) {
    console.warn(`[APPSTATE] ⚠️ فشل الحفظ في MongoDB: ${err.message}`);
    return false;
  }
}

// ── التحميل من MongoDB ───────────────────────────────────────────────────────

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

    if (!doc?.appState) return null;

    let restoredState = doc.appState;
    if (typeof restoredState === "string") {
      const decrypted = decryptBackupString(restoredState, console.warn);
      if (!decrypted) return null;
      try { restoredState = JSON.parse(decrypted); } catch { return null; }
    }
    if (!_validateAppState(restoredState)) return null;

    console.log(
      `[APPSTATE] 🍃 تم تحميل AppState من MongoDB` +
      ` (${restoredState.length} cookie، محفوظ: ${doc.savedAt?.toISOString() ?? "?"})`
    );
    return {
      appState: restoredState,
      savedAt:  doc.savedAt ?? new Date(0),
      source:   doc.source  ?? "mongo",
    };
  } catch (err) {
    console.warn(`[APPSTATE] ⚠️ فشل تحميل AppState من MongoDB: ${err.message}`);
    return null;
  }
}

// ── المقارنة وتحديد الأحدث ──────────────────────────────────────────────────

/**
 * يحدّد AppState المناسب للاستخدام من بين (البيئة، MongoDB).
 *
 * سياسة الاختيار:
 *   - إذا كان AppState في البيئة صالحاً → هو المصدر الصريح للمشغّل، يفوز.
 *     [NEW] في هذه الحالة نكتبه إلى MongoDB أيضاً، حتى تتوفر "آخر حالة صالحة"
 *     عند إقلاع لاحق بدون متغير بيئة.
 *   - إذا لم يكن صالحاً → نستخدم MongoDB.
 *
 * @param {Array|null}     envState
 * @param {number|string}  botIndex
 * @returns {Promise<{ state: Array|null, source: "env"|"mongo"|null }>}
 */
export async function resolveAppState(envState, botIndex = 1) {
  if (_validateAppState(envState)) {
    console.log("[APPSTATE] 🔑 استخدام AppState من متغير البيئة (أولوية المصدر الصريح)");

    // [NEW] write-back: حتى لو فازت البيئة، نُزامن MongoDB.
    // لا ننتظره — إذا فشل، سنحصل عليه من البيئة في الإقلاع القادم على أي حال.
    saveAppStateToMongo(envState, botIndex, "env-bootstrap").catch((err) =>
      console.warn(`[APPSTATE] ⚠️ bootstrap write-back failed: ${err.message}`)
    );

    return { state: envState, source: "env" };
  }

  const mongoDoc = await loadAppStateFromMongo(botIndex);
  if (!mongoDoc) {
    console.error("[APPSTATE] ❌ لا يوجد AppState لا في البيئة ولا في MongoDB");
    return { state: null, source: null };
  }

  console.log("[APPSTATE] 🔑 استخدام AppState من MongoDB (متغير البيئة فارغ أو غير صالح)");
  _syncEnvFromMongo(mongoDoc.appState);
  return { state: mongoDoc.appState, source: "mongo" };
}

// ── فحص انتهاء الصلاحية ─────────────────────────────────────────────────────

/**
 * يفحص إذا كانت أي كوكيز AppState تقترب من الانتهاء.
 *
 * @param {Array}  appState
 * @param {number} [warningMs=EXPIRY_WARNING_MS]
 * @returns {{ expiring: boolean, minTtlMs: number, expiresAt: Date|null, expiringSoon: string[] }}
 */
export function checkAppStateExpiry(appState, warningMs = EXPIRY_WARNING_MS) {
  if (!Array.isArray(appState)) {
    return { expiring: false, minTtlMs: Infinity, expiresAt: null, expiringSoon: [] };
  }

  const now = Date.now();
  let minTtl = Infinity;
  let minExp = null;
  const expiringSoon = [];

  for (const cookie of appState) {
    const name = String(cookie?.key ?? cookie?.name ?? "");
    const exp  = cookie?.expires;

    if (!exp || exp === "Infinity" || exp === Infinity) continue;

    const expMs =
      exp instanceof Date      ? exp.getTime()
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
    expiring:     minTtl < warningMs,
    minTtlMs:     minTtl === Infinity ? Infinity : Math.max(0, minTtl),
    expiresAt:    minExp,
    expiringSoon,
  };
}

// ── داخلي ────────────────────────────────────────────────────────────────────

function _isMongoBound() {
  return !!global.db;
}

function _syncEnvFromMongo(state) {
  try {
    // Keep the process environment free of session material. The live state
    // is available through the in-memory reference and the authenticated API.
    globalThis.appState  = state;
    bugLog("APPSTATE_MONGO", "Synced env from MongoDB", { cookieCount: state.length });
  } catch (e) {
    console.warn(`[APPSTATE] ⚠️ فشل مزامنة البيئة من MongoDB: ${e.message}`);
  }
}

function _validateAppState(state) {
  if (!Array.isArray(state) || state.length === 0) return false;
  const keys = new Set(state.map((c) => String(c?.key ?? c?.name ?? "")));
  return REQUIRED_COOKIES.every((k) => keys.has(k));
}