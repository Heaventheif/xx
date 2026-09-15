"use strict";
/**
 * session-extender.js — v2.0  (تحسين إطالة AppState)
 * ─────────────────────────────────────────────────────────────────────────────
 * مُمدِّد الجلسة الاستباقي المُحسَّن — يُراقب صحة AppState ويُجدِّده مبكراً
 * لضمان أطول عمر ممكن للجلسة.
 *
 * التحسينات الرئيسية في v2.0:
 *  1. keep-alive loop كل 6 ساعات (بدلاً من صفر) — يُبقي الكوكيز حيّة
 *  2. عتبة التجديد المبكر رُفعت من 6 أيام → 14 يوم
 *  3. warmup متعدد الـ endpoints لتجديد جميع الكوكيز دفعة واحدة
 *  4. حفظ AppState بعد كل keep-alive ناجح تلقائياً
 *  5. فحص الصحة كل 30 دقيقة (بدلاً من 60) لاكتشاف المشاكل أبكر
 *  6. تأخير عشوائي بين الطلبات لمحاكاة السلوك البشري
 */

import { EventEmitter }     from "node:events";
import {
  checkAppStateExpiry,
  EXPIRY_WARNING_MS,
  saveAppStateToMongo,
} from "../utils/appStatePersist.js";

// ── ثوابت ────────────────────────────────────────────────────────────────────

/** فاصل فحص الصحة — كل 30 دقيقة (بدلاً من 60) */
const HEALTH_CHECK_INTERVAL = 30 * 60 * 1_000;

/** إذا كانت أقل من 14 يوم على الانتهاء → جدِّد فوراً (أُضيفت 8 أيام إضافية) */
const REFRESH_THRESHOLD_MS  = 14 * 24 * 60 * 60 * 1_000;

/** فاصل الـ keep-alive — كل 6 ساعات لإبقاء الكوكيز نشطة */
const KEEP_ALIVE_INTERVAL   = 6 * 60 * 60 * 1_000;

/** الحد الأقصى لمحاولات التجديد المتتالية الفاشلة قبل التوقف المؤقت */
const MAX_CONSECUTIVE_FAILS = 5;

/** مدة التوقف المؤقت بعد فشل متكرر (30 دقيقة) */
const BACKOFF_AFTER_FAILS_MS = 30 * 60 * 1_000;

/**
 * قائمة endpoints خفيفة لـ keep-alive.
 * مُرتَّبة من الأخف إلى الأثقل — نستخدمها بالتسلسل لتجديد جميع الكوكيز.
 */
const KEEPALIVE_ENDPOINTS = [
  // ping خفيف جداً — لا يظهر في activity log
  "https://www.facebook.com/ajax/presence/reconnect.php",
  // الصفحة الرئيسية — تُجدِّد c_user + xs + fr معاً
  "https://www.facebook.com/",
  // Messenger — يُجدِّد ws_sk وكوكيز المحادثة
  "https://www.facebook.com/messages/",
];

// ─────────────────────────────────────────────────────────────────────────────

export class SessionExtender extends EventEmitter {
  /**
   * @param {object}   opts
   * @param {object}   opts.api               - FCA api object
   * @param {number}   opts.botIndex          - رقم البوت
   * @param {object}   [opts.cookieRefresher] - مثيل CookieRefresher
   * @param {object}   [opts.sessionGuard]    - مثيل SessionGuard
   * @param {Function} [opts.onExtended]      - callback بعد كل تجديد ناجح
   * @param {Function} [opts.onAppStateSave]  - callback لحفظ AppState (يأخذ state)
   * @param {number}   [opts.checkIntervalMs]       - فاصل الفحص (default: 30 min)
   * @param {number}   [opts.refreshThresholdMs]    - عتبة التجديد (default: 14d)
   * @param {number}   [opts.keepAliveIntervalMs]   - فاصل keep-alive (default: 6h)
   */
  constructor(opts = {}) {
    super();
    this._api             = opts.api;
    this._botIndex        = opts.botIndex ?? 1;
    this._cookieRefresher = opts.cookieRefresher ?? null;
    this._sessionGuard    = opts.sessionGuard    ?? null;
    this._onExtended      = typeof opts.onExtended     === "function" ? opts.onExtended     : null;
    this._onAppStateSave  = typeof opts.onAppStateSave === "function" ? opts.onAppStateSave : null;
    this._checkInterval   = opts.checkIntervalMs     ?? HEALTH_CHECK_INTERVAL;
    this._threshold       = opts.refreshThresholdMs  ?? REFRESH_THRESHOLD_MS;
    this._keepAliveMs     = opts.keepAliveIntervalMs ?? KEEP_ALIVE_INTERVAL;

    this._label         = `Bot-${this._botIndex}`;
    this._healthTimer   = null;
    this._keepAliveTimer= null;
    this._running       = false;
    this._extensions    = 0;
    this._keepAlives    = 0;
    this._lastExtension = null;
    this._lastKeepAlive = null;
    this._failCount     = 0;
    this._backoffUntil  = 0;
  }

  // ── واجهة عامة ────────────────────────────────────────────────────────────

  start() {
    if (this._running) return this;
    this._running = true;
    this._scheduleHealthCheck();
    this._scheduleKeepAlive();
    console.log(
      `[EXTENDER:${this._label}] ▶️ مُمدِّد الجلسة v2 نشط ` +
      `(فحص كل ${Math.round(this._checkInterval / 60_000)} دقيقة ` +
      `| keep-alive كل ${Math.round(this._keepAliveMs / 3_600_000)} ساعة ` +
      `| عتبة تجديد ${Math.round(this._threshold / 86_400_000)} يوم)`
    );
    return this;
  }

  stop() {
    this._running = false;
    if (this._healthTimer)    { clearTimeout(this._healthTimer);    this._healthTimer    = null; }
    if (this._keepAliveTimer) { clearTimeout(this._keepAliveTimer); this._keepAliveTimer = null; }
    console.log(`[EXTENDER:${this._label}] ⏹️ مُمدِّد الجلسة متوقف`);
    return this;
  }

  /** تجديد فوري — يمكن استدعاؤه يدوياً */
  async extendNow() {
    return this._doHealthCheck(true);
  }

  /** keep-alive فوري — يمكن استدعاؤه يدوياً */
  async pingNow() {
    return this._doKeepAlive(true);
  }

  getStats() {
    return {
      running:        this._running,
      extensions:     this._extensions,
      keepAlives:     this._keepAlives,
      lastExtension:  this._lastExtension,
      lastKeepAlive:  this._lastKeepAlive,
      failCount:      this._failCount,
      thresholdDays:  Math.round(this._threshold / 86_400_000),
    };
  }

  // ── جدولة فحص الصحة ───────────────────────────────────────────────────────

  _scheduleHealthCheck() {
    if (!this._running) return;
    const jitter = (Math.random() * 0.3 - 0.15) * this._checkInterval;
    const delay  = Math.max(60_000, Math.round(this._checkInterval + jitter));
    this._healthTimer = setTimeout(() => {
      this._doHealthCheck(false).finally(() => this._scheduleHealthCheck());
    }, delay);
    this._healthTimer?.unref?.();
  }

  // ── جدولة keep-alive ──────────────────────────────────────────────────────

  _scheduleKeepAlive() {
    if (!this._running) return;
    // أول ping بعد 30 دقيقة من الإقلاع (وليس فوراً لتجنب الضغط عند البدء)
    const initial = this._keepAlives === 0
      ? 30 * 60 * 1_000
      : this._keepAliveMs + (Math.random() * 20 - 10) * 60_000; // ±10 دقيقة jitter
    this._keepAliveTimer = setTimeout(() => {
      this._doKeepAlive(false).finally(() => this._scheduleKeepAlive());
    }, initial);
    this._keepAliveTimer?.unref?.();
  }

  // ── منطق فحص الصحة الرئيسي ───────────────────────────────────────────────

  async _doHealthCheck(manual = false) {
    const label = this._label;
    const now   = Date.now();

    if (!manual && now < this._backoffUntil) {
      const remaining = Math.round((this._backoffUntil - now) / 60_000);
      console.log(`[EXTENDER:${label}] ⏳ في فترة تهدئة — ${remaining} دقيقة متبقية`);
      return;
    }

    try {
      let currentState = null;
      try { currentState = this._api?.getAppState?.(); } catch (_) {}

      if (!currentState?.length) {
        console.warn(`[EXTENDER:${label}] ⚠️ لا يمكن قراءة AppState الحالي`);
        return;
      }

      const { expiring, minTtlMs, expiresAt } = checkAppStateExpiry(currentState, this._threshold);

      const daysLeft = isFinite(minTtlMs)
        ? (minTtlMs / 86_400_000).toFixed(1)
        : "∞";
      console.log(
        `[EXTENDER:${label}] 🩺 فحص الجلسة — ` +
        `${isFinite(minTtlMs) ? `تنتهي خلال ${daysLeft} يوم` : "كوكيز دائمة"}` +
        `${manual ? " (يدوي)" : ""}`
      );

      // تجديد مبكر إذا اقتربت الكوكيز من الانتهاء
      if (expiring || manual) {
        await this._refreshSession(expiresAt, manual);
      }

      // تجديد fb_dtsg دائماً
      await this._refreshFbDtsg();

      // heartbeat
      this._sessionGuard?.heartbeat();
      this._cookieRefresher?.heartbeat?.();

      this._failCount = 0;

    } catch (err) {
      this._failCount++;
      console.warn(`[EXTENDER:${label}] ❌ فشل فحص الصحة (${this._failCount}): ${err.message}`);

      if (this._failCount >= MAX_CONSECUTIVE_FAILS) {
        this._backoffUntil = Date.now() + BACKOFF_AFTER_FAILS_MS;
        console.error(
          `[EXTENDER:${label}] 🚨 ${MAX_CONSECUTIVE_FAILS} فشل متتالي — ` +
          `توقف مؤقت ${BACKOFF_AFTER_FAILS_MS / 60_000} دقيقة`
        );
        this._failCount = 0;
      }
    }
  }

  // ── منطق keep-alive الرئيسي ───────────────────────────────────────────────

  /**
   * يُرسل طلبات خفيفة إلى Facebook لإبقاء الكوكيز حيّة.
   * كل طلب ناجح يُجدِّد تلقائياً تاريخ انتهاء الكوكيز على خوادم Facebook.
   */
  async _doKeepAlive(manual = false) {
    const label = this._label;
    const ctx   = this._api?._ctx;
    const fns   = this._api?._defaultFuncs;

    if (!ctx || !fns?.get) {
      console.warn(`[EXTENDER:${label}] ⚠️ keep-alive: ctx أو defaultFuncs غير متاح`);
      return;
    }

    let successCount = 0;

    for (const endpoint of KEEPALIVE_ENDPOINTS) {
      try {
        // تأخير عشوائي بين الطلبات (2-5 ثوانٍ) لمحاكاة التصفح الطبيعي
        await _sleep(2_000 + Math.random() * 3_000);

        await fns.get(endpoint, ctx.jar, {}, { noRef: false, _skipSessionInspect: true });
        successCount++;
      } catch (e) {
        // فشل endpoint واحد لا يوقف الباقين
        console.warn(`[EXTENDER:${label}] ⚠️ keep-alive ${endpoint}: ${e.message}`);
      }
    }

    if (successCount > 0) {
      this._keepAlives++;
      this._lastKeepAlive = new Date().toISOString();
      console.log(
        `[EXTENDER:${label}] 💓 keep-alive #${this._keepAlives} — ` +
        `${successCount}/${KEEPALIVE_ENDPOINTS.length} endpoints ` +
        `${manual ? "(يدوي)" : ""}`
      );

      // احفظ AppState المُحدَّث بعد كل keep-alive ناجح
      await this._saveCurrentAppState("keep-alive");

      // heartbeat
      this._sessionGuard?.heartbeat();
    } else {
      console.warn(`[EXTENDER:${label}] ❌ keep-alive: جميع الـ endpoints فشلت`);
    }
  }

  // ── تجديد الكوكيز ─────────────────────────────────────────────────────────

  async _refreshSession(expiresAt, manual) {
    const label = this._label;
    const when  = expiresAt ? `(تنتهي: ${expiresAt.toISOString()})` : "";
    console.log(`[EXTENDER:${label}] 🔄 تجديد الكوكيز ${when}${manual ? " — طلب يدوي" : ""}...`);

    if (this._cookieRefresher) {
      await this._cookieRefresher.refresh();
    } else {
      await this._fullWarmup();
    }

    this._extensions++;
    this._lastExtension = new Date().toISOString();

    console.log(`[EXTENDER:${label}] ✅ تجديد #${this._extensions} — الجلسة مُمدَّدة`);
    this.emit("extended", { count: this._extensions, manual });
    this._onExtended?.({ count: this._extensions, manual });

    // حفظ AppState بعد التجديد
    await this._saveCurrentAppState("session-refresh");
  }

  async _refreshFbDtsg() {
    try {
      if (typeof this._api?.refreshFbDtsg === "function") {
        await this._api.refreshFbDtsg();
      }
    } catch (e) {
      console.warn(`[EXTENDER:${this._label}] ⚠️ تجديد fb_dtsg: ${e.message}`);
    }
  }

  /** warmup كامل بدون CookieRefresher */
  async _fullWarmup() {
    const ctx = this._api?._ctx;
    const fns = this._api?._defaultFuncs;
    if (!ctx || !fns?.get) return;

    for (const endpoint of KEEPALIVE_ENDPOINTS) {
      try {
        await _sleep(1_500 + Math.random() * 2_000);
        await fns.get(endpoint, ctx.jar, {});
      } catch (_) {}
    }
  }

  /** يحفظ AppState الحالي في الذاكرة + MongoDB */
  async _saveCurrentAppState(reason = "auto") {
    try {
      const state = this._api?.getAppState?.();
      if (!state?.length) return;

      // استخدام callback المُمرَّر من Client.js إن وُجد
      if (this._onAppStateSave) {
        this._onAppStateSave(state);
      } else {
        // حفظ مباشر في MongoDB كـ fallback
        await saveAppStateToMongo(state, this._botIndex, reason);
      }
    } catch (e) {
      console.warn(`[EXTENDER:${this._label}] ⚠️ فشل حفظ AppState (${reason}): ${e.message}`);
    }
  }
}

// ── أداة مساعدة ──────────────────────────────────────────────────────────────

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── مصنع مختصر ───────────────────────────────────────────────────────────────

export function createSessionExtender(opts) {
  return new SessionExtender(opts);
}

export default SessionExtender;
