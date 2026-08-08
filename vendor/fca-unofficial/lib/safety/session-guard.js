import nodefs from "node:fs";
import nodepath from "node:path";
import logger from "../func/logger.js";
const __importDefault = mod => mod && mod.__esModule ? mod : {
  default: mod
};
const fs_1 = __importDefault(nodefs);
const path_1 = __importDefault(nodepath);
const logger_1 = __importDefault(logger);
/** Maximum idle time before the watchdog emits a "stale" event. */
const DEFAULT_WATCHDOG_IDLE_MS = 5 * 60 * 1000; // 5 min
const DEFAULT_STORE_PATH = path_1.default.join(process.cwd(), ".session-store.json");
export class SessionGuard {
  constructor(options = {}) {
    // MED-3: Validate storePath to prevent path traversal.
    const rawPath = options.storePath ?? DEFAULT_STORE_PATH;
    const resolvedPath = path_1.default.resolve(rawPath);
    const allowedBase = path_1.default.resolve(process.cwd());
    if (!resolvedPath.startsWith(allowedBase + path_1.default.sep) && resolvedPath !== allowedBase) {
      throw new Error(`SessionGuard: storePath outside working directory is not allowed: ${resolvedPath}`);
    }
    this.options = {
      enabled: options.enabled !== false,
      storePath: resolvedPath,
      watchdogIdleMs: options.watchdogIdleMs ?? DEFAULT_WATCHDOG_IDLE_MS,
      watchdogIntervalMs: options.watchdogIntervalMs ?? 60_000
    };
    this._ctx = null;
    this._lastActivity = Date.now();
    this._watchdogTimer = null;
    this._onStale = null; // (ctx) => void
  }

  /** Attach to a live context right after login. */
  attach(ctx, {
    onStale
  } = {}) {
    this._ctx = ctx;
    if (typeof onStale === "function") this._onStale = onStale;

    // Try to recover tokens from previous run
    this._load();
    if (this.options.enabled) {
      this._startWatchdog();
    }
    return this;
  }

  /** Call this whenever a message/event is received — resets the idle clock. */
  heartbeat() {
    this._lastActivity = Date.now();
  }

  /** Persist fb_dtsg + jazoest to disk (call after any refresh). */
  save() {
    if (!this._ctx?.fb_dtsg) return;
    try {
      const data = {
        fb_dtsg: this._ctx.fb_dtsg,
        jazoest: this._ctx.jazoest ?? "",
        savedAt: new Date().toISOString()
      };
      const dir = path_1.default.dirname(this.options.storePath);
      if (!fs_1.default.existsSync(dir)) fs_1.default.mkdirSync(dir, {
        recursive: true, mode: 0o700
      });
      // SECURITY: fb_dtsg/jazoest are session tokens — restrict to owner-only.
      fs_1.default.writeFileSync(this.options.storePath, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
    } catch {
      // non-critical
    }
  }
  stop() {
    if (this._watchdogTimer) {
      clearInterval(this._watchdogTimer);
      this._watchdogTimer = null;
    }
  }
  get idleMs() {
    return Date.now() - this._lastActivity;
  }

  // ── private ──────────────────────────────────────────────────────────────

  _load() {
    try {
      if (fs_1.default.existsSync(this.options.storePath)) {
        const data = JSON.parse(fs_1.default.readFileSync(this.options.storePath, "utf8"));
        const ctx = this._ctx;
        if (data.fb_dtsg && ctx && (!ctx.fb_dtsg || ctx.fb_dtsg === "undefined")) {
          ctx.fb_dtsg = data.fb_dtsg;
          if (data.jazoest) ctx.jazoest = data.jazoest;
          logger_1.default("SessionGuard: recovered tokens from store", "info");
        }
      }
    } catch {
      // ignore
    }
  }
  _startWatchdog() {
    this.stop();
    this._watchdogTimer = setInterval(() => {
      const idle = this.idleMs;
      if (idle > this.options.watchdogIdleMs) {
        logger_1.default(`SessionGuard: session idle for ${Math.round(idle / 1000)}s — emitting stale`, "warn");
        try {
          this._onStale?.(this._ctx);
        } catch {
          // ignore handler errors
        }
      }
    }, this.options.watchdogIntervalMs);
    if (this._watchdogTimer.unref) this._watchdogTimer.unref();
  }
}
export function createSessionGuard(options) {
  return new SessionGuard(options);
}
export default {
  createSessionGuard,
  SessionGuard
};