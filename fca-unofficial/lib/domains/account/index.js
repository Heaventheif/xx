// account/index.js — Account domain: auth helpers, profile, friend management
import * as getUID        from './commands/get-current-user-id.js';
import * as logout        from './commands/logout.js';
import * as refreshDtsg   from './commands/refresh-fb-dtsg.js';
import * as addExternal   from './commands/add-external-module.js';
import * as autoSave      from './commands/enable-auto-save-app-state.js';
import * as changeBio     from './commands/change-bio.js';
import * as changeAvatar  from './commands/change-avatar.js';
import * as handleFriend  from './commands/handle-friend-request.js';
import * as unfriend      from './commands/unfriend.js';
import * as setReaction   from './commands/set-post-reaction.js';
import * as blockStatus   from './commands/change-blocked-status.js';
import * as follow        from './commands/follow.js';
import * as profileGuard  from './commands/set-profile-guard.js';
import * as acpUser       from './commands/acp-user.js';

function compact(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

/**
 * Creates the account domain, wiring all commands to their factory deps.
 * @param {object} deps
 */
export function createAccountDomain(deps) {
  return compact({
    addExternalModule:      addExternal.createAddExternalModuleCommand(deps.addExternalModule),
    getCurrentUserID:       getUID.createGetCurrentUserIdCommand(deps.currentUserId),
    enableAutoSaveAppState: autoSave.createEnableAutoSaveAppStateCommand(deps.enableAutoSaveAppState),
    logout:                 logout.createLogoutCommand(deps.logout),
    refreshFb_dtsg:         refreshDtsg.createRefreshFbDtsgCommand(deps.refreshFbDtsg),
    changeAvatar:           changeAvatar.createChangeAvatarCommand(deps.changeAvatar),
    changeBio:              changeBio.createChangeBioCommand(deps.changeBio),
    handleFriendRequest:    handleFriend.createHandleFriendRequestCommand(deps.handleFriendRequest),
    unfriend:               unfriend.createUnfriendCommand(deps.unfriend),
    setPostReaction:        setReaction.createSetPostReactionCommand(deps.setPostReaction),
    acpUser:                deps.acpUser ? acpUser.createAcpUserCommand(deps.acpUser) : undefined,
    changeBlockedStatus:    deps.changeBlockedStatus
                              ? blockStatus.createChangeBlockedStatusCommand(deps.changeBlockedStatus)
                              : undefined,
    follow:                 deps.follow ? follow.createFollowCommand(deps.follow) : undefined,
    setProfileGuard:        deps.setProfileGuard
                              ? profileGuard.createSetProfileGuardCommand(deps.setProfileGuard)
                              : undefined,
  });
}

export * from './account.types.js';
export * from './commands/add-external-module.js';
export * from './commands/enable-auto-save-app-state.js';
export * from './commands/get-current-user-id.js';
export * from './commands/logout.js';
export * from './commands/refresh-fb-dtsg.js';
export * from './commands/change-avatar.js';
export * from './commands/change-bio.js';
export * from './commands/change-blocked-status.js';
export * from './commands/handle-friend-request.js';
export * from './commands/unfriend.js';
export * from './commands/set-post-reaction.js';
export * from './commands/follow.js';
export * from './commands/set-profile-guard.js';
export * from './commands/acp-user.js';

var _default = { createAccountDomain };
export { _default as default };

// ─── Plugin Descriptor ───────────────────────────────────────────
/** @type {import('../../plugin-provider.js').FcaPlugin} */
export const $plugin = {
  name: 'fca-domains-account-index',
  meta: { category: 'domain-account', path: 'lib/domains/account/index.js' },
  setup(_ctx) {
    // provides: createAccountDomain
  },
};
