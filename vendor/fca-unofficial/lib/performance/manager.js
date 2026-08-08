import logger from "../func/logger.js";
const __importDefault = mod => mod && mod.__esModule ? mod : {
  default: mod
};
const logger_1 = __importDefault(logger);
export class PerformanceManager {
  constructor(options = {}) {
    this.options = {
      enableCache: options.enableCache !== false,
      cacheSize: options.cacheSize ?? 1000,
      cacheTTL: options.cacheTTL ?? 300_000,
      // 5 min
      enableMetrics: options.enableMetrics !== false,
      gcIntervalMs: options.gcIntervalMs ?? 60_000 // 1 min
    };

    /** @type {Map<string, {value: unknown, ts: number, ttl: number}>} */
    this._cache = new Map();
    this._requestTimes = [];
    this._gcTimer = null;
    this.metrics = {
      requests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      errors: 0,
      avgResponseTimeMs: 0,
      heapUsedBytes: 0
    };
    if (this.options.enableMetrics) {
      this._startGC();
    }
  }

  // ── cache ──────────────────────────────────────────────────────────────

  set(key, value, ttl = this.options.cacheTTL) {
    if (!this.options.enableCache) return;
    // Evict oldest entry when full
    if (this._cache.size >= this.options.cacheSize) {
      const oldest = this._cache.keys().next().value;
      this._cache.delete(oldest);
    }
    this._cache.set(key, {
      value,
      ts: Date.now(),
      ttl
    });
  }
  get(key) {
    if (!this.options.enableCache) return null;
    const item = this._cache.get(key);
    if (!item) {
      this.metrics.cacheMisses++;
      return null;
    }
    if (Date.now() - item.ts > item.ttl) {
      this._cache.delete(key);
      this.metrics.cacheMisses++;
      return null;
    }
    this.metrics.cacheHits++;
    return item.value;
  }
  delete(key) {
    this._cache.delete(key);
  }
  clear() {
    this._cache.clear();
  }

  // ── metrics ───────────────────────────────────────────────────────────

  trackRequest(startTimeMs) {
    const elapsed = Date.now() - startTimeMs;
    this.metrics.requests++;
    this._requestTimes.push(elapsed);
    if (this._requestTimes.length > 200) this._requestTimes.shift();
    const sum = this._requestTimes.reduce((a, b) => a + b, 0);
    this.metrics.avgResponseTimeMs = Math.round(sum / this._requestTimes.length);
  }
  trackError() {
    this.metrics.errors++;
  }
  getMetrics() {
    const total = this.metrics.cacheHits + this.metrics.cacheMisses;
    return {
      ...this.metrics,
      cacheSize: this._cache.size,
      cacheHitRate: total > 0 ? this.metrics.cacheHits / total : 0,
      heapUsedMB: +(this.metrics.heapUsedBytes / 1_048_576).toFixed(2)
    };
  }

  // ── lifecycle ─────────────────────────────────────────────────────────

  stop() {
    if (this._gcTimer) {
      clearInterval(this._gcTimer);
      this._gcTimer = null;
    }
  }

  // ── private ───────────────────────────────────────────────────────────

  _gc() {
    const now = Date.now();
    let evicted = 0;
    for (const [key, item] of this._cache) {
      if (now - item.ts > item.ttl) {
        this._cache.delete(key);
        evicted++;
      }
    }
    this.metrics.heapUsedBytes = process.memoryUsage().heapUsed;
    if (evicted > 0) {
      logger_1.default(`PerformanceManager: GC evicted ${evicted} stale entries`, "info");
    }
  }
  _startGC() {
    this._gcTimer = setInterval(() => this._gc(), this.options.gcIntervalMs);
    if (this._gcTimer.unref) this._gcTimer.unref();
  }
}
export function createPerformanceManager(options) {
  return new PerformanceManager(options);
}

/** Singleton for library-wide use. */
let _globalInstance = null;
export function getGlobalPerformanceManager(options) {
  if (!_globalInstance) _globalInstance = new PerformanceManager(options);
  return _globalInstance;
}
export default {
  createPerformanceManager,
  getGlobalPerformanceManager,
  PerformanceManager
};