/**
 * cookie-refresher.js — on-demand cookie warm-up.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CHANGES vs. previous version
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   1. DISABLED by default. Previously enabled unless explicitly disabled —
 *      it silently generated traffic. Now requires FCA_ENABLE_COOKIE_REFRESHER=true.
 *
 *   2. Single endpoint. Previously picked 1–3 URLs at random from a 4-URL
 *      pool, including the home feed. The home feed generates impression
 *      events visible in the account's activity log. We now always hit
 *      `/messages/`, which rotates c_user + xs + fr with minimal signal.
 *
 *   3. Rate-limited. A `minGapMs` (default 4h) prevents back-to-back
 *      refreshes even if `refresh()` is called in a tight loop.
 *
 *   4. Human timing preserved — the schedule uses `ActivityAwareScheduler`
 *      which applies Poisson + circadian weights.
 *
 *   5. Single-flight preserved — concurrent refresh calls share one promise.
 */
import logger from '../func/logger.js';
import {
  nextPoisson,
  nextLogNormal,
  createSessionSeed,
  ActivityAwareScheduler,
} from '../utils/human-timing.js';

// ─── Endpoints ───────────────────────────────────────────────────────────────

/**
 * Exactly ONE endpoint. `/messages/` is chosen because:
 *   - It rotates c_user + xs + fr (the three cookies that matter for session).
 *   - It does NOT generate a home-feed impression in the activity log.
 *   - It looks like a user checking their inbox, which is a normal action.
 */
const WARMUP_URLS = [
  'https://www.facebook.com/messages/',
];

function pickWarmupUrls() {
  return WARMUP_URLS.slice();
}

// ─── CookieRefresher ─────────────────────────────────────────────────────────

export class CookieRefresher {
  constructor(opts = {}) {
    this.options = {
      /**
       * Enabled only when explicitly requested. The previous default (on)
       * silently generated traffic that was indistinguishable from a bot.
       */
      enabled: opts.enabled === true || process.env.FCA_ENABLE_COOKIE_REFRESHER === 'true',

      /** Base mean interval. Jitter comes from ActivityAwareScheduler. */
      intervalMs: opts.intervalMs ?? 18_000_000,  // ~5h base

      /**
       * Hard floor between refreshes. Even if the scheduler fires early, we
       * refuse to refresh more than once per `minGapMs`.
       */
      minGapMs: opts.minGapMs ?? 4 * 60 * 60_000, // 4h

      backupEnabled: opts.backupEnabled !== false,
      maxBackups:    opts.maxBackups ?? 5,
      appStatePath:  opts.appStatePath ?? null,
      onAppStateUpdate: typeof opts.onAppStateUpdate === 'function'
        ? opts.onAppStateUpdate
        : null,
    };

    this._seed = createSessionSeed();
    this._scheduler = new ActivityAwareScheduler({
      seed: this._seed,
      baseMeanMs: this.options.intervalMs,
      minMs: this.options.intervalMs * 0.2,
      maxMs: this.options.intervalMs * 5,
    });

    this._timer          = null;
    this._ctx            = null;
    this._defaultFuncs   = null;
    this.refreshCount    = 0;
    this.lastRefreshAt   = 0;
    this._refreshPromise = null;   // single-flight
  }

  /**
   * Bind to a live session.
   * @param {object} ctx
   * @param {object} defaultFuncs
   */
  attach(ctx, defaultFuncs) {
    this._ctx          = ctx;
    this._defaultFuncs = defaultFuncs;
    if (this.options.enabled) this._schedule();
    return this;
  }

  /** Reset the idle timer (called on every MQTT event). */
  heartbeat() {
    this._scheduler.heartbeat();
  }

  /**
   * Perform a refresh. Single-flight — concurrent calls share one promise.
   * Rate-limited — refuses if the last refresh was within `minGapMs`.
   *
   * @returns {Promise<void>}
   */
  async refresh() {
    if (this._refreshPromise) return this._refreshPromise;
    this._refreshPromise = this._refreshImpl()
      .finally(() => { this._refreshPromise = null; });
    return this._refreshPromise;
  }

  async _refreshImpl() {
    if (!this._ctx || !this._defaultFuncs) {
      throw new Error('CookieRefresher: not bound to a context');
    }

    // ── Rate limit ─────────────────────────────────────────────────────────
    if (this.lastRefreshAt && Date.now() - this.lastRefreshAt < this.options.minGapMs) {
      logger('CookieRefresher: skipped (within minGap)', 'info');
      return;
    }

    const urls = pickWarmupUrls();
    logger(`CookieRefresher: refresh (${urls.length} URL)…`, 'info');

    let ok = false;

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      try {
        await this._defaultFuncs.get(url, this._ctx.jar, {});
        ok = true;
      } catch {
        // Individual failures are expected and not fatal — we still try the
        // remaining URLs so a single transient error doesn't abort the batch.
      }

      // Human-like spacing between URLs (only if there's a next one).
      if (i < urls.length - 1) {
        const wait = nextLogNormal(2_000, 0.5);
        await _sleep(Math.max(800, Math.min(wait, 12_000)));
      }
    }

    if (ok) {
      this.refreshCount++;
      this.lastRefreshAt = Date.now();
      logger(`CookieRefresher: refresh #${this.refreshCount} ✓`, 'info');
      this._publishAppState();
    } else {
      logger('CookieRefresher: all warmup URLs failed', 'warn');
    }
  }

  /** Stop the scheduler. Safe to call multiple times. */
  stop() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  _schedule() {
    this.stop();

    const wait = this._scheduler.nextDelay();

    this._timer = setTimeout(async () => {
      this._timer = null;
      try {
        await this.refresh();
      } catch (e) {
        logger(`CookieRefresher: error — ${e?.message}`, 'warn');
      }
      this._schedule();  // reschedule regardless of success/failure
    }, wait);

    this._timer?.unref?.();
  }

  /**
   * Publish the current AppState to the environment callback (if any).
   * The callback is responsible for encrypted persistence — this class does
   * NOT touch disk.
   */
  _publishAppState() {
    try {
      const jar = this._ctx?.jar;
      if (!jar || typeof jar.getCookiesSync !== 'function') return;

      const state = jar.getCookiesSync('https://www.facebook.com').map((c) => ({
        key:      c.key,
        value:    c.value,
        domain:   c.domain || '.facebook.com',
        path:     c.path || '/',
        secure:   !!c.secure,
        httpOnly: !!c.httpOnly,
        expires:  c.expires || 'Infinity',
      }));

      if (this.options.onAppStateUpdate) {
        this.options.onAppStateUpdate(state);
        logger('CookieRefresher: refreshed AppState published to the environment callback', 'info');
      } else {
        logger(
          'CookieRefresher: refreshed AppState available (no callback configured)',
          'info'
        );
      }
    } catch (e) {
      logger(`CookieRefresher: failed to publish AppState — ${e?.message}`, 'warn');
    }
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createCookieRefresher(opts) {
  return new CookieRefresher(opts);
}

function _sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export default { CookieRefresher, createCookieRefresher };

// ─── Plugin Descriptor ──────────────────────────────────────────────────────
/** @type {import('./plugin-provider.js').FcaPlugin} */
export const $plugin = {
  name: 'fca-safety-cookie-refresher',
  meta: { category: 'safety', path: 'lib/safety/cookie-refresher.js' },
  setup(_ctx) {
    // provides: CookieRefresher, createCookieRefresher
  },
};