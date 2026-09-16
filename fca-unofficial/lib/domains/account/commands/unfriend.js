// unfriend.js — Remove a friend from friends list
import * as legacyPromise from '../../../compat/legacy-promise.js';
import * as http from '../../../transport/http/facebook.js';

/**
 * Creates the unfriend command.
 *
 * @param {{ defaultFuncs, ctx, logError? }} deps
 * @returns {(userID: string, callback?: Function) => Promise<true>}
 */
export function createUnfriendCommand(deps) {
  const { defaultFuncs, ctx, logError } = deps;

  return function unfriend(userID, callback) {
    const { callback: cb, promise } = legacyPromise.createLegacyPromise(callback, false);

    http
      .postWithLoginCheck({
        defaultFuncs,
        ctx,
        url: 'https://www.facebook.com/ajax/profile/removefriendconfirm.php',
        form: {
          uid: userID,
          unref: 'bd_friends_tab',
          floc: 'friends_tab',
          'nctr[_mod]': `pagelet_timeline_app_collection_${ctx.userID}:2356318349:2`,
        },
      })
      .then((res) => {
        if (res?.error) throw res;
        cb(null, true);
      })
      .catch((err) => {
        logError?.('unfriend', err);
        cb(err instanceof Error ? err : new Error(String(err?.message ?? err)));
      });

    return promise;
  };
}

// ─── Plugin Descriptor ───────────────────────────────────────────
/** @type {import('../../../plugin-provider.js').FcaPlugin} */
export const $plugin = {
  name: 'fca-domains-account-commands-unfriend',
  meta: { category: 'domain-account', path: 'lib/domains/account/commands/unfriend.js' },
  setup(_ctx) {
    // provides: createUnfriendCommand
  },
};
