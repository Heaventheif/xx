import * as get_user_info_1 from "./queries/get-user-info.js";
import * as get_user_info_v2_1 from "./queries/get-user-info-v2.js";
import * as get_user_id_1 from "./queries/get-user-id.js";
import * as get_friends_list_1 from "./queries/get-friends-list.js";
function compactNamespace(namespace) {
  return Object.fromEntries(Object.entries(namespace).filter(([, value]) => value !== undefined));
}
export function createUsersDomain(deps) {
  return compactNamespace({
    getInfo: (0, get_user_info_1.createGetUserInfoQuery)(deps.info),
    getInfoV2: (0, get_user_info_v2_1.createGetUserInfoV2Query)(deps.infoV2),
    getID: (0, get_user_id_1.createGetUserIdQuery)(deps.idLookup),
    getFriends: deps.friendsList ? (0, get_friends_list_1.createGetFriendsListQuery)(deps.friendsList) : undefined
  });
}
export * from "./user.types.js";
export * from "./queries/get-friends-list.js";
export * from "./queries/get-user-info.js";
export * from "./queries/get-user-info-v2.js";
export * from "./queries/get-user-id.js";
export default {
  createUsersDomain
};