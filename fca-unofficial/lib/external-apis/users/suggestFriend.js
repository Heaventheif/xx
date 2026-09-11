/**
 * suggestFriend — returns friend suggestions for the current user.
 *
 * @param {Function} defaultFuncs
 * @param {object}   api
 * @param {object}   ctx
 * @returns {Function} suggestFriend(limit?, callback?)
 */
export default function suggestFriendFactory(defaultFuncs, api, ctx) {
  return async function suggestFriend(limit = 10, callback) {
    if (typeof limit === 'function') {
      callback = limit;
      limit = 10;
    }
    // Stub — returns empty list; a real implementation would hit the
    // /graphql endpoint for FriendingSuggestions.
    const result = { suggestions: [], limit };
    if (typeof callback === 'function') callback(null, result);
    return result;
  };
}

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../../../lib/plugin-provider.js').FcaPlugin} */
export const $plugin = {
  name: 'fca-external-apis-users-suggest-friend',
  meta: { category: 'external-api-users', path: 'lib/external-apis/users/suggestFriend.js' },
  setup(_ctx) {
    // provides: suggestFriendFactory
  },
};
