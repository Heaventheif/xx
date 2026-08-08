import nodefs from "node:fs";
import nodepath from "node:path";
import logger from "../func/logger.js";
const __importDefault = mod => mod && mod.__esModule ? mod : {
  default: mod
};
const fs_1 = __importDefault(nodefs);
const path_1 = __importDefault(nodepath);
const logger_1 = __importDefault(logger);
/**
 * Endpoints visited in order to keep the session warm.
 * Deliberately lightweight — no writes, no state-changing requests.
 */
const WARMUP_URLS = ["https://www.facebook.com/", "https://www.facebook.com/notifications", "https://www.facebook.com/messages/t/"];
export class CookieRefresher {
  constructor(options = {}) {
    this.options = {
      enabled: options.enabled !== false,
      intervalMs: options.intervalMs ?? 60 * 60 * 1000,
      // 1 h
      expiryDays: options.expiryDays ?? 60,
      backupEnabled: options.backupEnabled !== false,
      maxBackups: options.maxBackups ?? 5,
      appStatePath: options.appStatePath ?? null
    };
    this._timer = null;
    this._ctx = null;
    this._defaultFuncs = null;
    this.refreshCount = 0;
    this.lastRefreshAt = 0;
  }

  /** Attach context after login. Call once. */
  attach(ctx, defaultFuncs) {
    this._ctx = ctx;
    this._defaultFuncs = defaultFuncs;
    if (this.options.enabled) this._schedule();
    return this;
  }

  /** Force an immediate refresh regardless of the timer. */
  async refresh() {
    if (!this._ctx || !this._defaultFuncs) {
      throw new Error("CookieRefresher: not attached to a context");
    }
    logger_1.default("CookieRefresher: refreshing session cookies…", "info");
    let success = false;
    for (const url of WARMUP_URLS) {
      try {
        await this._defaultFuncs.get(url, this._ctx.jar, {});
        success = true;
      } catch {
        // non-fatal — try next URL
      }
      // brief human-like pause between requests
      await _sleep(1500 + Math.random() * 2000);
    }
    if (success) {
      if (this.options.expiryDays > 0) {
        this._extendExpiry();
      }
      this.refreshCount++;
      this.lastRefreshAt = Date.now();
      logger_1.default(`CookieRefresher: refresh #${this.refreshCount} complete`, "info");
      if (this.options.appStatePath) {
        this._saveAppState();
      }
    } else {
      logger_1.default("CookieRefresher: all warmup URLs failed", "warn");
    }
  }
  stop() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  // ── private ──────────────────────────────────────────────────────────────

  _schedule() {
    this.stop();
    this._timer = setTimeout(async () => {
      try {
        await this.refresh();
      } catch (err) {
        logger_1.default(`CookieRefresher: error — ${err?.message}`, "warn");
      }
      this._schedule(); // reschedule after completion
    }, this.options.intervalMs);
    if (this._timer.unref) this._timer.unref();
  }
  _extendExpiry() {
    try {
      const jar = this._ctx?.jar;
      if (!jar || typeof jar.getCookiesSync !== "function") return;
      const future = new Date(Date.now() + this.options.expiryDays * 86_400_000);
      const cookies = jar.getCookiesSync("https://www.facebook.com");
      for (const c of cookies) {
        if (c.expires && c.expires !== "Infinity") {
          c.expires = future;
        }
      }
    } catch {
      // ignore
    }
  }
  _saveAppState() {
    try {
      const jar = this._ctx?.jar;
      if (!jar) return;
      const cookies = jar.getCookiesSync("https://www.facebook.com").map(c => ({
        key: c.key,
        value: c.value,
        domain: c.domain || ".facebook.com",
        path: c.path || "/",
        secure: Boolean(c.secure),
        httpOnly: Boolean(c.httpOnly),
        expires: c.expires || "Infinity"
      }));
      const p = this.options.appStatePath;
      const dir = path_1.default.dirname(p);
      if (!fs_1.default.existsSync(dir)) fs_1.default.mkdirSync(dir, {
        recursive: true, mode: 0o700
      });
      // SECURITY: cookies are account credentials — restrict to owner-only.
      fs_1.default.writeFileSync(p, JSON.stringify(cookies, null, 2), { encoding: "utf8", mode: 0o600 });
    } catch (e) {
      logger_1.default(`CookieRefresher: save failed — ${e?.message}`, "warn");
    }
  }
}
export function createCookieRefresher(options) {
  return new CookieRefresher(options);
}
function _sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
export default {
  createCookieRefresher,
  CookieRefresher
};