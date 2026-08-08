"use strict";

// In-process LRU-ish cache with TTL eviction.
//
// CHANGED from original:
//   • Added _bridgePerfManager(pm): once global.perfManager is ready (set in
//     index.js after login), call this so cache hits/misses are reflected in
//     the fca PerformanceManager metrics dashboard (visible in cleanup logs).
//   • No functional changes to get/set/del/sweep.

const _store      = new Map();
const MAX_ENTRIES = 1500;

/** @type {import('../vendor/fca-unofficial/lib/performance/manager').PerformanceManager | null} */
let _pm = null;

// Call once after global.perfManager is initialised (in index.js onLoginSuccess).
function _bridgePerfManager(pm) {
  _pm = pm;
}

// Get a cached value if present and not expired.
function get(key) {
  const entry = _store.get(key);
  if (!entry) { _pm?.metrics && (_pm.metrics.cacheMisses++); return null; }
  if (Date.now() > entry.expiresAt) {
    _store.delete(key);
    _pm?.metrics && (_pm.metrics.cacheMisses++);
    return null;
  }
  entry.gen = (_store._gen = (_store._gen || 0) + 1);
  _pm?.metrics && (_pm.metrics.cacheHits++);
  return entry.value;
}

// Store a value with a time-to-live.
function set(key, value, ttlMs = 5 * 60 * 1000) {
  if (_store.size >= MAX_ENTRIES && !_store.has(key)) {
    // Evict the least-recently-used entry (lowest generation counter).
    let oldestKey = null;
    let oldestGen = Infinity;
    for (const [k, e] of _store) {
      if (e.gen < oldestGen) { oldestGen = e.gen; oldestKey = k; }
    }
    if (oldestKey) _store.delete(oldestKey);
  }
  _store.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
    gen: (_store._gen = (_store._gen || 0) + 1),
  });
  return value;
}

// Remove a value from the cache.
function del(key) { _store.delete(key); }

// Remove all expired entries and return the count removed.
function sweep() {
  const now     = Date.now();
  let   removed = 0;
  for (const [key, entry] of _store) {
    if (now > entry.expiresAt) { _store.delete(key); removed++; }
  }
  return removed;
}

// Current number of cached entries.
function size() { return _store.size; }

export { get, set, del, sweep, size, _bridgePerfManager };
export default { get, set, del, sweep, size, _bridgePerfManager };
