import m  from './messaging/changeBlockedStatusMqtt.js';
import Ue from './action/acpUser.js';
import * as ye from './utils/antiDetection.js';
import * as De from './utils/userAgents.js';
import * as Ge from './utils/ws3Compat.js';
import * as Ee from './utils/mostakimCompat.js';
import sendMessageWithRetryFactory from './messaging/sendMessageWithRetry.js';

const e = {
  changeBlockedStatusMqtt: m,
  acpUser: Ue,
  AntiDetection: ye,
  UserAgents: De,
  ws3Compat: Ge,
  mostakimCompat: Ee,
  sendMessageWithRetry: sendMessageWithRetryFactory,
};
var nt = e;
export { e as EXTERNAL_API_FACTORIES, nt as default };

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('./plugin-provider.js').FcaPlugin} */
export const $plugin = {
  name: 'fca-external-apis-index',
  meta: { category: 'external-api-index.js', path: 'lib/external-apis/index.js' },
  setup(_ctx) {
    // provides: EXTERNAL_API_FACTORIES
  },
};
