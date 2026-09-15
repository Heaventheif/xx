"use strict";
/**
 * session-extender.js
 * ─────────────────────────────────────────────────────────────────────────────
 * مُمدِّد الجلسة الاستباقي — يُراقب صحة AppState ويُجدِّده قبل انتهائه.
 *
 * ما يفعله:
 *  1. كل HEALTH_CHECK_INTERVAL يفحص:
 *     - هل تقترب كوكيز AppState من الانتهاء؟   → يُطلق refresh فوري
 *     - هل fb_dtsg لا يزال صالحاً؟              → يُجدِّده إذا لزم
 *     - هل CookieRefresher لا يزال يعمل؟        → يُعيد تشغيله إذا توقف
 *  2. يُحدِّث heartbeat لـ SessionGuard و CookieRefresher بانتظام.
 *  3. يُسجِّل حدث "extended" ويتصل بـ onExtended callback عند كل تجديد.
 *
 * الاستخدام (في onBotReady داخل Client.js):
 *   const extender = new SessionExtender({ api, botIndex, cookieRefresher });
 *   extender.start();
 *   api._sessionExtender = extender;
 */

import { EventEmitter }     from "node:events";
import {
  checkAppStateExpiry,
  EXPIRY_WARNING_MS,
  saveAppStateToMongo,
} from "../utils/appStatePersist.js";

// ── ثوابت ────────────────────────────────────────────────────────────────────

/** فاصل فحص الصحة (كل ساعة) */
const HEALTH_CHECK_INTERVAL = 60 * 60 * 1_000;

/** إذا كانت أقل من هذه المدة على الانتهاء → جدِّد فوراً (6 أيام) */
const REFRESH_THRESHOLD_MS  = 6 * 24 * 60 * 60 * 1_000;

/** الحد الأقصى لمحاولات التجديد المتتالية الفاشلة قبل التوقف المؤقت */
const MAX_CONSECUTIVE_FAILS = 5;

/** مدة التوقف المؤقت بعد فشل متكرر (30 دقيقة) */
const BACKOFF_AFTER_FAILS_MS = 30 * 60 * 1_000;

// ─────────────────────────────────────────────────────────────────────────────

export class SessionExtender extends EventEmitter {
  /**
   * @param {object}   opts
   * @param {object}   opts.api             - FCA api object
   * @param {number}   opts.botIndex        - رقم البوت
   * @param {object}   [opts.cookieRefresher]  - مثيل CookieRefresher
   * @param {object}   [opts.sessionGuard]     - مثيل SessionGuard
   * @param {Function} [opts.onExtended]       - callback بعد كل تجديد ناجح
   * @param {number}   [opts.checkIntervalMs]  - فاصل الفحص (default: 1h)
   * @param {number}   [opts.refreshThresholdMs] - عتبة التجديد (default: 6d)
   */
  constructor(opts = {}) {
    super();
    this._api             = opts.api;
    this._botIndex        = opts.botIndex ?? 1;
    this._cookieRefresher = opts.cookieRefresher ?? null;
    this._sessionGuard    = opts.sessionGuard    ?? null;
    this._onExtended      = typeof opts.onExtended === "function" ? opts.onExtended : null;
    this._checkInterval   = opts.checkIntervalMs   ?? HEALTH_CHECK_INTERVAL;
    this._threshold       = opts.refreshThresholdMs ?? REFRESH_THRESHOLD_MS;

    this._label         = `Bot-${this._botIndex}`;
    this._timer         = null;
    this._running       = false;
    this._extensions    = 0;
    this._lastExtension = null;
    this._failCount     = 0;
    this._backoffUntil  = 0;
  }

  // ── واجهة عامة ────────────────────────────────────────────────────────────

  start() {
    if (this._running) return this;
    this._running = true;
    this._schedule();
    console.log(
      `[EXTENDER:${this._label}] ▶️ مُمدِّد الجلسة نشط ` +
      `(فحص كل ${Math.round(this._checkInterval / 60_000)} دقيقة)`
    );
    return this;
  }

  stop() {
    this._running = false;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    console.log(`[EXTENDER:${this._label}] ⏹️ مُمدِّد الجلسة متوقف`);
    return this;
  }

  /** تجديد فوري — يمكن استدعاؤه يدوياً */
  async extendNow() {
    return this._doHealthCheck(true);
  }

  getStats() {
    return {
      running:       this._running,
      extensions:    this._extensions,
      lastExtension: this._lastExtension,
      failCount:     this._failCount,
    };
  }

  // ── داخلي ─────────────────────────────────────────────────────────────────

  _schedule() {
    if (!this._running) return;
    // تأخير عشوائي ±15% لتجنب التزامن
    const jitter = (Math.random() * 0.3 - 0.15) * this._checkInterval;
    const delay  = Math.max(60_000, Math.round(this._checkInterval + jitter));
    this._timer  = setTimeout(() => {
      this._doHealthCheck(false).finally(() => this._schedule());
    }, delay);
    this._timer?.unref?.();
  }

  async _doHealthCheck(manual = false) {
    const label = this._label;
    const now   = Date.now();

    // تجاهل إذا كنا في فترة backoff
    if (!manual && now < this._backoffUntil) {
      const remaining = Math.round((this._backoffUntil - now) / 60_000);
      console.log(`[EXTENDER:${label}] ⏳ في فترة تهدئة — ${remaining} دقيقة متبقية`);
      return;
    }

    try {
      // 1. اقرأ AppState الحالي
      let currentState = null;
      try {
        currentState = this._api?.getAppState?.();
      } catch (_) {}

      if (!currentState?.length) {
        console.warn(`[EXTENDER:${label}] ⚠️ لا يمكن قراءة AppState الحالي`);
        return;
      }

      // 2. فحص الانتهاء
      const { expiring, minTtlMs, expiresAt } = checkAppStateExpiry(currentState, this._threshold);

      const daysLeft = isFinite(minTtlMs) ? (minTtlMs / 86_400_000).toFixed(1) : "∞";
      console.log(
        `[EXTENDER:${label}] 🩺 فحص الجلسة — ` +
        `${isFinite(minTtlMs) ? `تنتهي خلال ${daysLeft} يوم` : "كوكيز دائمة"}` +
        `${manual ? " (يدوي)" : ""}`
      );

      // 3. تجديد الكوكيز إذا كانت تقترب من الانتهاء
      if (expiring || manual) {
        await this._refreshSession(expiresAt, manual);
      }

      // 4. تجديد fb_dtsg في كل حالة (يبقى صالحاً لفترة قصيرة)
      await this._refreshFbDtsg();

      // 5. إرسال heartbeat لـ SessionGuard
      this._sessionGuard?.heartbeat();
      this._cookieRefresher?.heartbeat?.();

      this._failCount = 0; // إعادة ضبط عداد الفشل عند النجاح

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

  async _refreshSession(expiresAt, manual) {
    const label = this._label;
    const when  = expiresAt ? `(تنتهي: ${expiresAt.toISOString()})` : "";
    console.log(`[EXTENDER:${label}] 🔄 تجديد الكوكيز ${when}${manual ? " — طلب يدوي" : ""}...`);

    if (this._cookieRefresher) {
      await this._cookieRefresher.refresh();
    } else {
      // إذا لم يكن CookieRefresher متاحاً، حاول مباشرة عبر http
      await this._manualWarmup();
    }

    this._extensions++;
    this._lastExtension = new Date().toISOString();

    console.log(`[EXTENDER:${label}] ✅ تجديد #${this._extensions} — الجلسة مُمدَّدة`);
    this.emit("extended", { count: this._extensions, manual });
    this._onExtended?.({ count: this._extensions, manual });
  }

  async _refreshFbDtsg() {
    try {
      if (typeof this._api?.refreshFbDtsg === "function") {
        await this._api.refreshFbDtsg();
      }
    } catch (e) {
      // fb_dtsg refresh فاشل لا يُوقف الفحص
      console.warn(`[EXTENDER:${this._label}] ⚠️ تجديد fb_dtsg: ${e.message}`);
    }
  }

  /** warmup بسيط بدون CookieRefresher */
  async _manualWarmup() {
    const ctx = this._api?._ctx;
    if (!ctx) return;

    const fns = this._api?._defaultFuncs;
    if (!fns?.get) return;

    try {
      await fns.get("https://www.facebook.com/", ctx.jar, {});
    } catch (_) {}
  }
}

// ── مصنع مختصر ───────────────────────────────────────────────────────────────

export function createSessionExtender(opts) {
  return new SessionExtender(opts);
}

export default SessionExtender;
