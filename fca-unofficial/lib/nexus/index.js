var M = Object.defineProperty;
var t = (o, e) => M(o, 'name', { value: e, configurable: !0 });
import m from './api/follow.js';
import C from './api/changeBlockedStatusMqtt.js';
import S from './api/getUID.js';
import N from './api/getBotInitialData.js';
import l from './api/getAccess.js';
import B from './api/getCtx.js';
import D from './api/listenRealtime.js';
import R from './api/listenSpeed.js';
import { getThreadColors as threadColors } from './api/threadColors.js';
function Q(o, e, r) {
  return (
    (o.follow = m(e, o, r)),
    (o.changeBlockedStatusMqtt = C(e, o, r)),
    (o.getUID = S(e, o, r)),
    (o.getBotInitialData = N(e, o, r)),
    (o.getAccess = l(e, o, r)),
    (o.getCtx = B(e, o, r)),
    (o.listenRealtime = D(e, o, r)),
    (o.listenSpeed = R(e, o, r)),
    o
  );
}
t(Q, 'attachNexusMethods');
export {
  Q as attachNexusMethods,
  C as changeBlockedStatusMqtt,
  m as follow,
  l as getAccess,
  N as getBotInitialData,
  B as getCtx,
  S as getUID,
  D as listenRealtime,
  R as listenSpeed,
  threadColors,
};

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('./plugin-provider.js').FcaPlugin} */
export const $plugin = {
  name: 'fca-nexus-index',
  meta: { category: 'nexus', path: 'lib/nexus/index.js' },
  setup(_ctx) {
    // provides: attachNexusMethods
  },
};
