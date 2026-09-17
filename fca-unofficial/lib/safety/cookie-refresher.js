import logger from '../func/logger.js';
import {
  nextPoisson,
  nextLogNormal,
  createSessionSeed,
  ActivityAwareScheduler,
} from '../utils/human-timing.js';

const WARMUP_URLS = [
  'https://www.facebook.com/',
  'https://www.facebook.com/notifications/',
  'https://www.facebook.com/?sk=nf',
  'https://www.facebook.com/?sk=h_chr',
];

function pickWarmupUrls() {
  const shuffled = [...WARMUP_URLS].sort(() => Math.random() - 0.5);
  
  const r = Math.random();
  const count = r < 0.6 ? 1 : r < 0.9 ? 2 : 3;
  return shuffled.slice(0, count);
}

export class CookieRefresher {
  constructor(opts = {}) {
    this.options = {
      enabled: opts.enabled !== false,
      intervalMs: opts.intervalMs ?? 18_000_000, 
      backupEnabled: opts.backupEnabled !== false,
      maxBackups: opts.maxBackups ?? 5,
      appStatePath: opts.appStatePath ?? null,
      onAppStateUpdate: typeof opts.onAppStateUpdate === "function" ? opts.onAppStateUpdate : null,
    };

    this._seed = createSessionSeed();
    this._scheduler = new ActivityAwareScheduler({
      seed: this._seed,
      baseMeanMs: this.options.intervalMs,
      minMs: this.options.intervalMs * 0.2, 
      maxMs: this.options.intervalMs * 5, 
    });

    this._timer = null;
    this._ctx = null;
    this._defaultFuncs = null;
    this.refreshCount = 0;
    this.lastRefreshAt = 0;
    this._refreshPromise = null;
  }

  attach(ctx, defaultFuncs) {
    this._ctx = ctx;
    this._defaultFuncs = defaultFuncs;
    if (this.options.enabled) this._schedule();
    return this;
  }

  
  heartbeat() {
    this._scheduler.heartbeat();
  }

  async refresh() {
    // Single-flight guard prevents concurrent warmups from racing over the same jar.
    if (this._refreshPromise) return this._refreshPromise;
    this._refreshPromise = this._refreshImpl().finally(() => { this._refreshPromise = null; });
    return this._refreshPromise;
  }

  async _refreshImpl() {
    if (!this._ctx || !this._defaultFuncs)
      throw new Error('CookieRefresher: لم يتم الربط بـ context');

    const urls = pickWarmupUrls();
    logger(`CookieRefresher: تجديد (${urls.length} URL) …`, 'info');

    let ok = false;
    for (const url of urls) {
      try {
        await this._defaultFuncs.get(url, this._ctx.jar, {});
        ok = true;
      } catch {
        
      }

      
      if (urls.indexOf(url) < urls.length - 1) {
        const wait = nextLogNormal(2_000, 0.5); 
        await _sleep(Math.max(800, Math.min(wait, 12_000)));
      }
    }

    if (ok) {
      this.refreshCount++;
      this.lastRefreshAt = Date.now();
      logger(`CookieRefresher: تجديد #${this.refreshCount} ✓`, 'info');
      this._publishAppState();
    } else {
      logger('CookieRefresher: فشلت كل روابط الـ warmup', 'warn');
    }
  }

  stop() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  _schedule() {
    this.stop();

    
    const wait = this._scheduler.nextDelay();

    this._timer = setTimeout(async () => {
      this._timer = null;
      try {
        await this.refresh();
      } catch (e) {
        logger(`CookieRefresher: خطأ — ${e?.message}`, 'warn');
      }
      this._schedule(); 
    }, wait);
    if (this._timer?.unref) this._timer.unref();
  }

  _publishAppState() {
    try {
      const jar = this._ctx?.jar;
      if (!jar || typeof jar.getCookiesSync !== "function") return;
      const state = jar.getCookiesSync("https://www.facebook.com").map((c) => ({
        key: c.key, value: c.value, domain: c.domain || ".facebook.com", path: c.path || "/",
        secure: !!c.secure, httpOnly: !!c.httpOnly, expires: c.expires || "Infinity",
      }));
      const serialized = JSON.stringify(state);
      if (this.options.onAppStateUpdate) {
        this.options.onAppStateUpdate(state, serialized);
        logger("CookieRefresher: refreshed AppState published to the environment callback", "info");
      } else {
        logger("CookieRefresher: refreshed AppState available: " + serialized, "info");
      }
    } catch (e) {
      logger(`CookieRefresher: failed to publish AppState — ${e?.message}`, "warn");
    }
  }

}

export function createCookieRefresher(opts) {
  return new CookieRefresher(opts);
}

function _sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export default { CookieRefresher, createCookieRefresher };

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('./plugin-provider.js').FcaPlugin} */
export const $plugin = {
  name: 'fca-safety-cookie-refresher',
  meta: { category: 'safety', path: 'lib/safety/cookie-refresher.js' },
  setup(_ctx) {
    // provides: CookieRefresher, createCookieRefresher
  },
};
