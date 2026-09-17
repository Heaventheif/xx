import * as legacy from '../../../compat/legacy-promise.js';
import * as constants from '../../../utils/constants.js';
import * as request from '../../../utils/request/index.js';

// One refresh promise per FCA context prevents concurrent requests from overwriting tokens.
const refreshLocks = new WeakMap();

function createRefreshFbDtsgCommand({ ctx }) {
  return function refreshFbDtsg(options, callback) {
    let input = options;
    let cb = callback;
    if (typeof input === 'function') { cb = input; input = {}; }
    input = input || {};
    if (typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('The first parameter must be an object or a callback function');
    }

    const { callback: done, promise } = legacy.createLegacyPromise(cb);
    const applyResult = (result) => {
      done(null, result);
      return result;
    };
    const fail = (error) => { done(error); throw error; };

    if (Object.keys(input).length > 0) {
      Object.assign(ctx, input);
      return promise;
    }

    let current = refreshLocks.get(ctx);
    if (!current) {
      current = request
        .get('https://www.facebook.com/', ctx.jar, null, ctx.globalOptions, { noRef: true })
        .then(({ data }) => {
          const fb_dtsg = constants.getFrom(data, '["DTSGInitData",[],{"token":"', '",');
          const jazoest = constants.getFrom(data, 'jazoest=', '",');
          if (!fb_dtsg) throw new Error('Could not find fb_dtsg in HTML after requesting Facebook.');
          // Update the live context atomically before resolving all waiting callers.
          ctx.fb_dtsg = fb_dtsg;
          ctx.jazoest = jazoest;
          return { data: { fb_dtsg, jazoest }, message: 'Refreshed fb_dtsg and jazoest' };
        })
        .finally(() => refreshLocks.delete(ctx));
      refreshLocks.set(ctx, current);
    }

    current.then(applyResult, (error) => { done(error); }).catch(() => {});
    return promise;
  };
}

export { createRefreshFbDtsgCommand };
export default { createRefreshFbDtsgCommand };

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('./plugin-provider.js').FcaPlugin} */
export const $plugin = {
  name: 'fca-domains-account-commands-refresh-fb-dtsg',
  meta: { category: 'domain-account', path: 'lib/domains/account/commands/refresh-fb-dtsg.js' },
  setup(_ctx) {
    // provides: createRefreshFbDtsgCommand
  },
};
