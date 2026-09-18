/**
 * mqtt.js — MQTT compatibility helpers.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CHANGES vs. previous version
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   - fb_dtsg refresh is DISABLED by default. It used to run every 3h (±30m),
 *     which was both redundant (SessionExtender already refreshes on a 6h
 *     cadence) and produced a distinguishable network pattern.
 *
 *   - When enabled via FCA_ENABLE_MQTT_DTSG_REFRESH=true, the default interval
 *     is 6h and the jitter is ±60m — aligned with SessionExtender.
 *
 * Return value is `null` when disabled, and callers already guard against it
 * (`if (interval) interval.unref()`).
 */
var h = Object.defineProperty;
var s = (t, e) => h(t, 'name', { value: e, configurable: !0 });

const y = s((t, e) => {
  const r = t.api;
  if (!r || typeof r.listenMqtt != 'function')
    throw new Error('listenMqtt is not available on current context');
  return r.listenMqtt((i, c) => {
    if (i) {
      e?.({ type: 'error', error: i });
      return;
    }
    e?.(c);
  });
}, 'listenMqtt');

function M(t, e = {}) {
  const r = e.logger,
    o = s((u, l = 'info') => {
      try {
        typeof r == 'function' && r(u, l);
      } catch {}
    }, 'log');

  // لو كنا نستخدم API بلا refreshFb_dtsg، لا شيء لنفعله.
  if (t.listenMqtt && !t.listen) t.listen = t.listenMqtt;
  if (typeof t.refreshFb_dtsg != 'function') return null;

  // ══════════════════════════════════════════════════════════════════════════
  // OPT-IN ONLY. Default = no synthetic traffic.
  // ══════════════════════════════════════════════════════════════════════════
  if (String(process.env.FCA_ENABLE_MQTT_DTSG_REFRESH || '').toLowerCase() !== 'true') {
    return null;
  }

  const i = e.refreshIntervalMs ?? 21600 * 1e3;  // 6h
  const c = 3600 * 1e3;                          // ±60min jitter

  let n = 0;
  const g = 5;  // max consecutive failures before escalating to error-level logs

  function a() {
    const u = i + (Math.random() - 0.5) * 2 * c;
    return setTimeout(async function () {
      try {
        await t.refreshFb_dtsg();
        n = 0;
        o('Successfully refreshed fb_dtsg');
      } catch (l) {
        n++;
        const d = l?.message ?? String(l);
        o(`fb_dtsg refresh failed (attempt ${n}): ${d}`, 'warn');
        if (n >= g) {
          o(`fb_dtsg refresh failed ${n} times — session may be expired`, 'error');
        }
      }
      a();
    }, u);
  }
  s(a, 'scheduleRefresh');

  const f = a();
  f?.unref?.();
  return f;
}
s(M, 'attachMqttCompatibility');

var b = { attachMqttCompatibility: M, listenMqtt: y };
export { M as attachMqttCompatibility, b as default, y as listenMqtt };

// ─── Plugin Descriptor ──────────────────────────────────────────────────────
/** @type {import('./plugin-provider.js').FcaPlugin} */
export const $plugin = {
  name: 'fca-core-mqtt',
  meta: { category: 'core', path: 'lib/core/mqtt.js' },
  setup(_ctx) {
    // provides: attachMqttCompatibility, listenMqtt
  },
};