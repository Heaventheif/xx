"use strict";
/**
 * session-extender.js — v2.1
 * ─────────────────────────────────────────────────────────────────────────────
 * مُمدِّد الجلسة الاستباقي — يُراقب صحة AppState ويُجدِّده عند الحاجة.
 *
 * التغييرات في v2.1:
 *  - [BREAKING BEHAVIOR] keep-alive معطَّل افتراضياً. يتطلب
 *    FCA_ENABLE_KEEPALIVE=true لتفعيله. السبب: هذه الطلبات الاصطناعية
 *    كانت تُنتج بصمة سلوكية قابلة للاكتشاف (زيارات منتظمة لـ 3 endpoints).
 *  - [BREAKING BEHAVIOR] فاصل keep-alive زاد من 6h → 24h عندما يكون مفعّلاً.
 *  - [BREAKING BEHAVIOR] قائمة endpoints تقلّصت من 3 → 1.
 *    `/messages/` فقط. `/` و `/ajax/presence/reconnect.php` أُزيلا لأن
 *    الأول يُنشئ impression في activity log، والثاني أصلاً علامة سلوك روبوتي.
 *  - عتبة التجديد المبكر بقيت عند 14 يوم.
 *  - فحص الصحة بقيت كل 30 دقيقة (رخيص محلياً، لا شبكة).
 *
 * ملاحظة: هذا الـ module يقرأ حالة الجلسة محلياً (بدون شبكة) في الفحص
 * الدوري. الشبكة تُلمس فقط عند التجديد أو عند تفعيل keep-alive.
 */

import { EventEmitter } from "node:events";
import {
  checkAppStateExpiry,
  EXPIRY_WARNING_MS,
  saveAppStateToMongo,
} from "../utils/appStatePersist.js";

// ── ثوابت ────────────────────────────────────────────────────────────────────

/** فاصل فحص الصحة — كل 30 دقيقة. لا يلمس الشبكة. */
const HEALTH_CHECK_INTERVAL = 30 * 60 * 1_000;

/** إذا كانت أقل من 14 يوم على الانتهاء → جدِّد فوراً */
const REFRESH_THRESHOLD_MS  = 14 * 24 * 60 * 60 * 1_000;

/**
 * فاصل keep-alive — 24 ساعة.
 * [CHANGED] كان 6 ساعات. هذا كان ينتج 4 زيارات/يوم لكل account. الآن زيارة
 * واحدة فقط، وهذا أكثر شبهاً بمستخدم حقيقي يفتح Messenger مرة يومياً.
 */
const KEEP_ALIVE_INTERVAL   = 24 * 60 * 60 * 1_000;

/** الحد الأقصى لمحاولات التجديد المتتالية الفاشلة قبل التوقف المؤقت */
const MAX_CONSECUTIVE_FAILS = 5;

/** مدة التوقف المؤقت بعد فشل متكرر (30 دقيقة) */
const BACKOFF_AFTER_FAILS_MS = 30 * 60 * 1_000;

/**
 * نقطة keep-alive وحيدة.
 * ─────────────────────────────────────────────────────────────────────────────
 * لماذا `/messages/` فقط؟
 *   - تُجدِّد c_user + xs + fr (الكوكيز الثلاثة المهمة للجلسة).
 *   - لا تُنشئ home-feed impression في activity log.
 *   - تعادل سلوك مستخدم يفتح Messenger — أمر طبيعي تماماً.
 *
 * لماذا لا `/`؟
 *   - تُنشئ home-feed impression، وهو سلوك روبوتي متكرر.
 *
 * لماذا لا `/ajax/presence/reconnect.php`؟
 *   - متكرر، ومحفوف بمخاطر: Facebook يعتبره signal قوي على أتمتة.
 */
const KEEPALIVE_ENDPOINTS = [
  "https://www.facebook.com/messages/",
];

// ─────────────────────────────────────────────────────────────────────────────

export class SessionExtender extends EventEmitter {
  /**
   * @param {object}   opts
   * @param {object}   opts.api
   * @param {number}   opts.botIndex
   * @param {object}   [opts.cookieRefresher]
   * @param {object}   [opts.sessionGuard]
   * @param {Function} [opts.onExtended]
   * @param {Function} [opts.onAppStateSave]
   * @param {number}   [opts.checkIntervalMs]
   * @param {number}   [opts.refreshThresholdMs]
   * @param {number}   [opts.keepAliveIntervalMs]
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

    this._label          = `Bot-${this._botIndex}`;
    this._healthTimer    = null;
    this._keepAliveTimer = null;
    this._running        = false;
    this._extensions     = 0;
    this._keepAlives     = 0;
    this._lastExtension  = null;
    this._lastKeepAlive  = null;
    this._failCount      = 0;
    this._backoffUntil   = 0;
  }

  // ── واجهة عامة ─────────────────────────────────────────────────────────────

  start() {
    if (this._running) return this;
    this._running = true;

    this._scheduleHealthCheck();

    // keep-alive هو opt-in صريح.
    const keepAliveEnabled =
      String(process.env.FCA_ENABLE_KEEPALIVE || "").toLowerCase() === "true";
    if (this._keepAliveMs > 0 && keepAliveEnabled) {
      this._scheduleKeepAlive();
    }

    console.log(
      `[EXTENDER:${this._label}] ▶️ مُمدِّد الجلسة v2.1 نشط ` +
      `(فحص كل ${Math.round(this._checkInterval / 60_000)} دقيقة ` +
      `| keep-alive ${keepAliveEnabled ? `كل ${Math.round(this._keepAliveMs / 3_600_000)} ساعة` : "معطّل"} ` +
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

  /** تجديد فوري (فحص صحة كامل). */
  async extendNow() {
    return this._doHealthCheck(true);
  }

  /** keep-alive فوري — يتجاوز الفحص الشرطي. */
  async pingNow() {
    return this._doKeepAlive(true);
  }

  getStats() {
    return {
      running:       this._running,
      extensions:    this._extensions,
      keepAlives:    this._keepAlives,
      lastExtension: this._lastExtension,
      lastKeepAlive: this._lastKeepAlive,
      failCount:     this._failCount,
      thresholdDays: Math.round(this._threshold / 86_400_000),
    };
  }

  // ── جدولة فحص الصحة ────────────────────────────────────────────────────────

  _scheduleHealthCheck() {
    if (!this._running) return;
    const jitter = (Math.random() * 0.3 - 0.15) * this._checkInterval;
    const delay  = Math.max(60_000, Math.round(this._checkInterval + jitter));

    this._healthTimer = setTimeout(() => {
      this._doHealthCheck(false).finally(() => this._scheduleHealthCheck());
    }, delay);
    this._healthTimer?.unref?.();
  }

  // ── جدولة keep-alive ───────────────────────────────────────────────────────

  _scheduleKeepAlive() {
    if (!this._running || this._keepAliveMs <= 0) return;

    // أول ping بعد 30 دقيقة من الإقلاع (لا نضرب Facebook فوراً).
    const initial = this._keepAlives === 0
      ? 30 * 60 * 1_000
      : this._keepAliveMs + (Math.random() * 20 - 10) * 60_000;  // ±10min jitter

    this._keepAliveTimer = setTimeout(() => {
      this._doKeepAlive(false).finally(() => this._scheduleKeepAlive());
    }, initial);
    this._keepAliveTimer?.unref?.();
  }

  // ── منطق فحص الصحة ─────────────────────────────────────────────────────────

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

      if (expiring || manual) {
        await this._refreshSession(expiresAt, manual);
      }

      // refreshFbDtsg لا يُنتج كوكيز جديدة، لكنه يُحدِّث token قديم.
      await this._refreshFbDtsg();

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

  // ── منطق keep-alive ────────────────────────────────────────────────────────

  /**
   * يُرسل طلبات خفيفة إلى Facebook لإبقاء الكوكيز حيّة.
   * معطَّل افتراضياً — يتطلب FCA_ENABLE_KEEPALIVE=true. يُستدعى يدوياً
   * عبر pingNow() في أي وقت بغض النظر عن الإعداد.
   */
  async _doKeepAlive(manual = false) {
    if (!manual && String(process.env.FCA_ENABLE_KEEPALIVE || "").toLowerCase() !== "true") {
      return;
    }

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
        // تأخير عشوائي (2–5 ثوانٍ) لمحاكاة التنقل الطبيعي.
        await _sleep(2_000 + Math.random() * 3_000);

        await fns.get(endpoint, ctx.jar, {}, { noRef: false, _skipSessionInspect: true });
        successCount++;
      } catch (e) {
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

      await this._saveCurrentAppState("keep-alive");
      this._sessionGuard?.heartbeat();
    } else {
      console.warn(`[EXTENDER:${label}] ❌ keep-alive: جميع الـ endpoints فشلت`);
    }
  }

  // ── تجديد الكوكيز ──────────────────────────────────────────────────────────

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

  /** warmup بديل عندما لا يكون CookieRefresher مربوطاً */
  async _fullWarmup() {
    const ctx = this._api?._ctx;
    const fns = this._api?._defaultFuncs;
    if (!ctx || !fns?.get) return;

    for (const endpoint of KEEPALIVE_ENDPOINTS) {
      try {
        await _sleep(1_500 + Math.random() * 2_000);
        await fns.get(endpoint, ctx.jar, {});
      } catch (_) { /* سنُسجّل النتائج عبر الإحصاءات */ }
    }
  }

  /** يحفظ AppState الحالي عبر الـ callback أو MongoDB مباشرة. */
  async _saveCurrentAppState(reason = "auto") {
    try {
      const state = this._api?.getAppState?.();
      if (!state?.length) return;

      if (this._onAppStateSave) {
        this._onAppStateSave(state);
      } else {
        await saveAppStateToMongo(state, this._botIndex, reason);
      }
    } catch (e) {
      console.warn(`[EXTENDER:${this._label}] ⚠️ فشل حفظ AppState (${reason}): ${e.message}`);
    }
  }
}

// ── أدوات مساعدة ─────────────────────────────────────────────────────────────

function _sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createSessionExtender(opts) {
  return new SessionExtender(opts);
}

export default SessionExtender;