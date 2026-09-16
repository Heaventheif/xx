// users/index.js — Users domain: profile info, ID lookup, friends list
import * as getUserInfo    from './queries/get-user-info.js';
import * as getUserInfoV2  from './queries/get-user-info-v2.js';
import * as getUserId      from './queries/get-user-id.js';
import * as getFriendsList from './queries/get-friends-list.js';

function compact(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

/**
 * Creates the users domain.
 * @param {object} deps
 */
export function createUsersDomain(deps) {
  return compact({
    getInfo:    getUserInfo.createGetUserInfoQuery(deps.info),
    getInfoV2:  getUserInfoV2.createGetUserInfoV2Query(deps.infoV2),
    getID:      getUserId.createGetUserIdQuery(deps.idLookup),
    getFriends: deps.friendsList
                  ? getFriendsList.createGetFriendsListQuery(deps.friendsList)
                  : undefined,
  });
}

export * from './user.types.js';
export * from './queries/get-friends-list.js';
export * from './queries/get-user-info.js';
export * from './queries/get-user-info-v2.js';
export * from './queries/get-user-id.js';

var _default = { createUsersDomain };
export { _default as default };

// ─── Plugin Descriptor ───────────────────────────────────────────
/** @type {import('../../plugin-provider.js').FcaPlugin} */
export const $plugin = {
  name: 'fca-domains-users-index',
  meta: { category: 'domain-users', path: 'lib/domains/users/index.js' },
  setup(_ctx) {
    // provides: createUsersDomain
  },
};
