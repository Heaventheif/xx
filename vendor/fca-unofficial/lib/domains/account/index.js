import * as get_current_user_id_1 from "./commands/get-current-user-id.js";
import * as logout_1 from "./commands/logout.js";
import * as refresh_fb_dtsg_1 from "./commands/refresh-fb-dtsg.js";
import * as add_external_module_1 from "./commands/add-external-module.js";
import * as enable_auto_save_app_state_1 from "./commands/enable-auto-save-app-state.js";
import * as change_bio_1 from "./commands/change-bio.js";
import * as change_avatar_1 from "./commands/change-avatar.js";
import * as handle_friend_request_1 from "./commands/handle-friend-request.js";
import * as unfriend_1 from "./commands/unfriend.js";
import * as set_post_reaction_1 from "./commands/set-post-reaction.js";
import * as change_blocked_status_1 from "./commands/change-blocked-status.js";
import * as follow_1 from "./commands/follow.js";
import * as set_profile_guard_1 from "./commands/set-profile-guard.js";
function compactNamespace(namespace) {
  return Object.fromEntries(Object.entries(namespace).filter(([, value]) => value !== undefined));
}
export function createAccountDomain(deps) {
  return compactNamespace({
    addExternalModule: (0, add_external_module_1.createAddExternalModuleCommand)(deps.addExternalModule),
    getCurrentUserID: (0, get_current_user_id_1.createGetCurrentUserIdCommand)(deps.currentUserId),
    enableAutoSaveAppState: (0, enable_auto_save_app_state_1.createEnableAutoSaveAppStateCommand)(deps.enableAutoSaveAppState),
    logout: (0, logout_1.createLogoutCommand)(deps.logout),
    refreshFb_dtsg: (0, refresh_fb_dtsg_1.createRefreshFbDtsgCommand)(deps.refreshFbDtsg),
    changeAvatar: (0, change_avatar_1.createChangeAvatarCommand)(deps.changeAvatar),
    changeBio: (0, change_bio_1.createChangeBioCommand)(deps.changeBio),
    handleFriendRequest: (0, handle_friend_request_1.createHandleFriendRequestCommand)(deps.handleFriendRequest),
    unfriend: (0, unfriend_1.createUnfriendCommand)(deps.unfriend),
    setPostReaction: (0, set_post_reaction_1.createSetPostReactionCommand)(deps.setPostReaction),
    changeBlockedStatus: deps.changeBlockedStatus ? (0, change_blocked_status_1.createChangeBlockedStatusCommand)(deps.changeBlockedStatus) : undefined,
    follow: deps.follow ? (0, follow_1.createFollowCommand)(deps.follow) : undefined,
    setProfileGuard: deps.setProfileGuard ? (0, set_profile_guard_1.createSetProfileGuardCommand)(deps.setProfileGuard) : undefined
  });
}
export * from "./account.types.js";
export * from "./commands/add-external-module.js";
export * from "./commands/enable-auto-save-app-state.js";
export * from "./commands/get-current-user-id.js";
export * from "./commands/logout.js";
export * from "./commands/refresh-fb-dtsg.js";
export * from "./commands/change-avatar.js";
export * from "./commands/change-bio.js";
export * from "./commands/change-blocked-status.js";
export * from "./commands/handle-friend-request.js";
export * from "./commands/unfriend.js";
export * from "./commands/set-post-reaction.js";
export * from "./commands/follow.js";
export * from "./commands/set-profile-guard.js";
export default {
  createAccountDomain
};