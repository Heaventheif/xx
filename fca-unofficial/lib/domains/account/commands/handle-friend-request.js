// handle-friend-request.js — Accept or decline a friend request via GraphQL mutation
// الـ endpoint القديم /requests/friends/ajax/ أصبح 404 — نستخدم GraphQL فقط
import * as legacyPromise from '../../../compat/legacy-promise.js';
import * as http from '../../../transport/http/facebook.js';

/**
 * قبول أو رفض طلب صداقة عبر GraphQL mutation.
 *
 * @param {{ defaultFuncs, ctx, logError? }} deps
 * @returns {(userID: string, accept: boolean, callback?: Function) => Promise}
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

    const uid = String(userID);

    // ── قبول: FriendingCometFriendRequestConfirmMutation ──────────
    if (accept) {
      http
        .postWithLoginCheck({
          defaultFuncs,
          ctx,
          url: 'https://www.facebook.com/api/graphql/',
          form: {
            av: ctx.userID,
            __user: ctx.userID,
            __a: '1',
            fb_dtsg: ctx.fb_dtsg,
            jazoest: ctx.ttstamp || ctx.jazoest || '',
            lsd: ctx.lsd || ctx.lsdToken || ctx.fb_dtsg,
            fb_api_caller_class: 'RelayModern',
            fb_api_req_friendly_name: 'FriendingCometFriendRequestConfirmMutation',
            variables: JSON.stringify({
              input: {
                source: 'friends_tab',
                friend_requester_id: uid,
                actor_id: ctx.userID,
                client_mutation_id: String(Math.floor(Math.random() * 1e9)),
              },
            }),
            server_timestamps: 'true',
            doc_id: '6003738476371496',
          },
        })
        .then((res) => {
          if (res?.errors?.length) throw new Error(JSON.stringify(res.errors[0]));
          cb(null, { userID: uid, action: 'accepted', success: true });
        })
        .catch((err) => {
          logError?.('handleFriendRequest(accept)', err);
          cb(err instanceof Error ? err : new Error(String(err?.message ?? err)));
        });

      return promise;
    }

    // ── رفض: FriendingCometFriendRequestDeleteMutation ────────────
    http
      .postWithLoginCheck({
        defaultFuncs,
        ctx,
        url: 'https://www.facebook.com/api/graphql/',
        form: {
          av: ctx.userID,
          __user: ctx.userID,
          __a: '1',
          fb_dtsg: ctx.fb_dtsg,
          jazoest: ctx.ttstamp || ctx.jazoest || '',
          lsd: ctx.lsd || ctx.lsdToken || ctx.fb_dtsg,
          fb_api_caller_class: 'RelayModern',
          fb_api_req_friendly_name: 'FriendingCometFriendRequestDeleteMutation',
          variables: JSON.stringify({
            input: {
              friend_requester_id: uid,
              actor_id: ctx.userID,
              client_mutation_id: String(Math.floor(Math.random() * 1e9)),
            },
          }),
          server_timestamps: 'true',
          doc_id: '5574260925973988',
        },
      })
      .then((res) => {
        if (res?.errors?.length) throw new Error(JSON.stringify(res.errors[0]));
        cb(null, { userID: uid, action: 'declined', success: true });
      })
      .catch((err) => {
        logError?.('handleFriendRequest(decline)', err);
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
  setup(_ctx) {},
};
