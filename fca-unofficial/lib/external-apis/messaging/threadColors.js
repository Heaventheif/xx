import { getThreadColors as e, createGetThreadColorsQuery as r } from '../../domains/threads/queries/get-thread-colors.js';
var a = { getThreadColors: e, createGetThreadColorsQuery: r };
export { r as createGetThreadColorsQuery, a as default, e as getThreadColors };

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('./plugin-provider.js').FcaPlugin} */
export const $plugin = {
  name: 'fca-external-messaging-thread-colors',
  meta: { category: 'external-messaging', path: 'lib/external-apis/messaging/threadColors.js' },
  setup(_ctx) {
    // provides: getThreadColors, createGetThreadColorsQuery
  },
};
