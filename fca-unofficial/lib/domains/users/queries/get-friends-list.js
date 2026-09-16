// get-friends-list.js — Fetch the full friends list for the logged-in user
import * as legacyPromise from '../../../compat/legacy-promise.js';
import * as formDataHttp from '../../../transport/http/form-data.js';
import formatUtils from '../../../utils/format/index.js';

const { formatID } = formatUtils;

const GENDERS = {
  0: 'unknown',
  1: 'female_singular',
  2: 'male_singular',
  3: 'female_singular_guess',
  4: 'male_singular_guess',
  5: 'mixed',
  6: 'neuter_singular',
  7: 'unknown_singular',
  8: 'female_plural',
  9: 'male_plural',
  10: 'neuter_plural',
  11: 'unknown_plural',
};

function formatFriends(payload) {
  return Object.keys(payload).map((key) => {
    const user = payload[key];
    return {
      alternateName: user.alternateName || null,
      firstName: user.firstName || null,
      gender: GENDERS[user.gender] || 'unknown',
      userID: formatID(String(user.id || '')),
      isFriend: !!user.is_friend,
      fullName: user.name || null,
      profilePicture: user.thumbSrc || null,
      type: user.type || null,
      profileUrl: user.uri || null,
      vanity: user.vanity || null,
      isBirthday: !!user.is_birthday,
    };
  });
}

/**
 * Creates the getFriendsList query.
 * Fetches the complete friend list using the legacy chat endpoint.
 *
 * @param {{ defaultFuncs, ctx, logError? }} deps
 * @returns {(callback?: Function) => Promise<Array>}
 */
export function createGetFriendsListQuery(deps) {
  const { defaultFuncs, ctx, logError } = deps;

  return function getFriendsList(callback) {
    const { callback: cb, promise } = legacyPromise.createLegacyPromise(callback, []);

    formDataHttp
      .postFormDataWithLoginCheck({
        defaultFuncs,
        ctx,
        url: 'https://www.facebook.com/chat/user_info_all',
        form: {},
        query: { viewer: ctx.userID },
      })
      .then((res) => {
        if (!res) throw { error: 'getFriendsList returned empty object.' };
        if (res?.error) throw res;
        cb(null, formatFriends(res.payload || {}));
      })
      .catch((err) => {
        logError?.('getFriendsList', err);
        cb(err instanceof Error ? err : new Error(String(err?.message ?? err)));
      });

    return promise;
  };
}

// ─── Plugin Descriptor ───────────────────────────────────────────
/** @type {import('../../../plugin-provider.js').FcaPlugin} */
export const $plugin = {
  name: 'fca-domains-users-queries-get-friends-list',
  meta: { category: 'domain-users', path: 'lib/domains/users/queries/get-friends-list.js' },
  setup(_ctx) {
    // provides: createGetFriendsListQuery
  },
};
