// handle-friend-request.js — Accept or decline an incoming friend request
import * as legacyPromise from '../../../compat/legacy-promise.js';
import * as http from '../../../transport/http/facebook.js';

/**
 * Creates the handleFriendRequest command.
 *
 * @param {{ defaultFuncs, ctx, logError? }} deps
 * @returns {(userID: string, accept: boolean, callback?: Function) => Promise<{userID, action, success}>}
 *
 * @example
 * await api.handleFriendRequest(userID, true);   // accept
 * await api.handleFriendRequest(userID, false);  // decline
 */
export function createHandleFriendRequestCommand(deps) {
  const { defaultFuncs, ctx, logError } = deps;

  return function handleFriendRequest(userID, accept, callback) {
    if (typeof accept !== 'boolean') {
      throw new Error(
        'handleFriendRequest: second argument must be a boolean (true = accept, false = decline).',
      );
    }

    const { callback: cb, promise } = legacyPromise.createLegacyPromise(callback);

    if (!userID) {
      cb(new Error('handleFriendRequest: userID is required'));
      return promise;
    }

    http
      .postWithLoginCheck({
        defaultFuncs,
        ctx,
        url: 'https://www.facebook.com/requests/friends/ajax/',
        form: {
          viewer_id: ctx.userID,
          'frefs[0]': 'jwl',
          floc: 'friend_center_requests',
          ref: '/reqs.php',
          action: accept ? 'confirm' : 'reject',
          friend_requester_id: String(userID),
          fb_dtsg: ctx.fb_dtsg,
          lsd: ctx.lsd || ctx.fb_dtsg,
          jazoest: ctx.jazoest,
        },
      })
      .then((res) => {
        if (res?.payload?.err) throw new Error(JSON.stringify(res.payload.err));
        cb(null, { userID, action: accept ? 'accepted' : 'declined', success: true });
      })
      .catch((err) => {
        logError?.('handleFriendRequest', err);
        cb(err instanceof Error ? err : new Error(String(err?.message ?? err)));
      });

    return promise;
  };
}

// ─── Plugin Descriptor ───────────────────────────────────────────
/** @type {import('../../../plugin-provider.js').FcaPlugin} */
export const $plugin = {
  name: 'fca-domains-account-commands-handle-friend-request',
  meta: { category: 'domain-account', path: 'lib/domains/account/commands/handle-friend-request.js' },
  setup(_ctx) {
    // provides: createHandleFriendRequestCommand
  },
};
