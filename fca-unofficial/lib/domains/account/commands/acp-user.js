// acp-user.js — Accept a friend request via GraphQL (FriendingCometFriendRequestConfirmMutation)
import * as legacyPromise from '../../../compat/legacy-promise.js';
import * as http from '../../../transport/http/facebook.js';
import { getSignatureID } from '../../../utils/format/index.js';

/**
 * Creates the acpUser command.
 * Accepts a pending friend request for the given userID.
 *
 * @param {{ defaultFuncs, ctx, logError? }} deps
 * @returns {(userID: string, callback?: Function) => Promise<{userID, ok, friendshipStatus, timestamp}>}
 */
export function createAcpUserCommand(deps) {
  const { defaultFuncs, ctx, logError } = deps;

  return async function acpUser(userID, callback) {
    const { callback: cb, promise } = legacyPromise.createLegacyPromise(callback, null);

    if (!userID) {
      const err = new Error('acpUser: userID is required');
      cb(err);
      return promise;
    }

    const params = {
      av: ctx.userID,
      __aaid: 0,
      __user: ctx.userID,
      __a: 1,
      __req: getSignatureID(),
      dpr: 1,
      __ccg: 'EXCELLENT',
      __rev: ctx.req_ID || '1027405870',
      __hsi: ctx.hsi || '',
      __comet_req: 15,
      fb_dtsg: ctx.fb_dtsg,
      jazoest: ctx.ttstamp,
      lsd: ctx.fb_dtsg,
      fb_api_caller_class: 'RelayModern',
      fb_api_req_friendly_name: 'FriendingCometFriendRequestConfirmMutation',
      variables: JSON.stringify({
        input: {
          source: 'friends_tab',
          friend_requester_id: String(userID),
          actor_id: ctx.userID,
          client_mutation_id: String(Math.floor(Math.random() * 1e9)),
        },
      }),
      server_timestamps: true,
      doc_id: '6003738476371496',
    };

    http
      .postWithLoginCheck({
        defaultFuncs,
        ctx,
        url: 'https://www.facebook.com/api/graphql/',
        form: params,
      })
      .then((res) => {
        if (res?.error) throw res;
        const result = {
          userID,
          ok: true,
          friendshipStatus:
            res?.data?.friend_request_confirm?.friend_requesters?.[0]?.friendship_status ??
            'ARE_FRIENDS',
          timestamp: Date.now(),
        };
        cb(null, result);
      })
      .catch((err) => {
        logError?.('acpUser', err);
        cb(err instanceof Error ? err : new Error(String(err?.message ?? err)));
      });

    return promise;
  };
}

// ─── Plugin Descriptor ───────────────────────────────────────────
/** @type {import('../../../plugin-provider.js').FcaPlugin} */
export const $plugin = {
  name: 'fca-domains-account-commands-acp-user',
  meta: { category: 'domain-account', path: 'lib/domains/account/commands/acp-user.js' },
  setup(_ctx) {
    // provides: createAcpUserCommand
  },
};
