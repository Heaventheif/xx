/**
 * advancedSessionGuard — monitors session health and triggers re-auth when
 * the cookie/appState is invalidated.
 *
 * This is a stub implementation that does nothing harmful;
 * the real implementation would watch MQTT disconnect events and
 * checkpoint errors to decide when to re-login.
 */
export default function advancedSessionGuardFactory(defaultFuncs, api, ctx) {
  return function advancedSessionGuard(options = {}, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    // No-op stub — session guard is not active.
    if (typeof callback === 'function') callback(null, { active: false });
    return { stop: () => {}, active: false };
  };
}

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../../plugin-provider.js').FcaPlugin} */
export const $plugin = {
  name: 'fca-external-apis-action-advanced-session-guard',
  meta: { category: 'external-api-action', path: 'lib/external-apis/action/advancedSessionGuard.js' },
  setup(_ctx) {},
};
