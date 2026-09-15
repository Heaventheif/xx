import fs from 'node:fs';
import path from 'node:path';
import logger from '../func/logger.js';
import {
  nextPoisson,
  nextLogNormal,
  createSessionSeed,
  ActivityAwareScheduler,
} from '../utils/human-timing.js';
import { canWriteBackup, encryptBackupString, decryptBackupString } from './backup-crypto.js';

const WARMUP_URLS = [
  'https://www.facebook.com/',
  'https://www.facebook.com/messages/',
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
      expiryDays: opts.expiryDays ?? 60,
      backupEnabled: opts.backupEnabled !== false,
      maxBackups: opts.maxBackups ?? 5,
      appStatePath: opts.appStatePath ?? null,
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
      if (this.options.expiryDays > 0) this._extendExpiry();
      this.refreshCount++;
      this.lastRefreshAt = Date.now();
      logger(`CookieRefresher: تجديد #${this.refreshCount} ✓`, 'info');
      if (this.options.appStatePath) this._saveAppState();
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

  _extendExpiry() {
    try {
      const jar = this._ctx?.jar;
      if (!jar || typeof jar.getCookiesSync !== 'function') return;
      const exp = new Date(Date.now() + this.options.expiryDays * 86_400_000);
      const cookies = jar.getCookiesSync('https://www.facebook.com');
      for (const c of cookies) if (c.expires && c.expires !== 'Infinity') c.expires = exp;
    } catch {
      
    }
  }

  _saveAppState() {
    try {
      const jar = this._ctx?.jar;
      if (!jar) return;
      const cookies = jar.getCookiesSync('https://www.facebook.com').map((c) => ({
        key: c.key,
        value: c.value,
        domain: c.domain || '.facebook.com',
        path: c.path || '/',
        secure: !!c.secure,
        httpOnly: !!c.httpOnly,
        expires: c.expires || 'Infinity',
      }));

      if (!canWriteBackup(logger)) return;
      const serialized = encryptBackupString(JSON.stringify(cookies));

      // [FIX APPSTATE] نكتب على مسار .backup منفصل لتجنب الكتابة فوق appstate.json
      // الذي يقرأه Client.js كـ JSON عادي — الكتابة فوقه بمحتوى مشفّر تكسر إعادة التشغيل
      const backupPath = this.options.appStatePath
        ? this.options.appStatePath.replace(/\.json$/, '') + '.backup'
        : null;
      if (!backupPath) return;

      const dir = path.dirname(backupPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(backupPath, serialized, { encoding: 'utf8', mode: 0o600 });
    } catch (e) {
      logger(`CookieRefresher: فشل الحفظ — ${e?.message}`, 'warn');
    }
  }

  
  static loadAppState(appStatePath) {
    // [FIX APPSTATE] نحاول .backup أولاً، ثم المسار الأصلي للتوافق مع النسخ القديمة
    const backupPath = appStatePath
      ? appStatePath.replace(/\.json$/, '') + '.backup'
      : null;
    const candidates = [backupPath, appStatePath].filter(Boolean);
    for (const p of candidates) {
      try {
        if (!fs.existsSync(p)) continue;
        const raw = fs.readFileSync(p, 'utf8');
        const plaintext = decryptBackupString(raw, logger);
        if (plaintext == null) continue;
        return JSON.parse(plaintext);
      } catch (e) {
        logger(`CookieRefresher: فشل تحميل AppState من ${p} — ${e?.message}`, 'warn');
      }
    }
    return null;
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
