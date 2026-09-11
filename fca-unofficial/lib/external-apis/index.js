import r  from './messaging/addUserToGroup.js';
import t  from './messaging/changeAdminStatus.js';
import a  from './messaging/changeBlockedStatus.js';
import m  from './messaging/changeBlockedStatusMqtt.js';
import g  from './messaging/deleteMessage.js';
import d  from './messaging/deleteThread.js';
import h  from './messaging/editMessage.js';
import T  from './messaging/getFriendsList.js';
import S  from './messaging/getMessage.js';
import M  from './messaging/handleMessageRequest.js';
import v  from './messaging/markAsDelivered.js';
import I  from './messaging/markAsRead.js';
import R  from './messaging/markAsReadAll.js';
import C  from './messaging/markAsSeen.js';
import D  from './messaging/removeUserFromGroup.js';
import E  from './messaging/scheduler.js';
import B  from './messaging/sendMessage.js';
import X  from './messaging/unsendMessage.js';
import z  from './messaging/uploadAttachment.js';
import Y  from './users/getUserInfo.js';
import Z  from './users/getUserInfoV2.js';
import $  from './threads/getThreadHistory.js';
import ee from './threads/getThreadInfo.js';
import re from './threads/getThreadList.js';
import te from './threads/getThreadPictures.js';
import _e from './action/enableAutoSaveAppState.js';
import ge from './action/follow.js';
import de from './action/getCurrentUserID.js';
import he from './action/handleFriendRequest.js';
import le from './action/logout.js';
import ue from './action/refreshFb_dtsg.js';
import Ue from './action/acpUser.js';
import * as ye from './utils/antiDetection.js';
import * as De from './utils/userAgents.js';
import * as Ge from './utils/ws3Compat.js';
import * as Ee from './utils/mostakimCompat.js';
import sendMessageWithRetryFactory from './messaging/sendMessageWithRetry.js';

const e = {
  // [UNIFIED] covered by domains: addUserToGroup: r,
  // [UNIFIED] covered by domains: changeAdminStatus: t,
  // [UNIFIED] covered by domains: changeBlockedStatus: a,
  changeBlockedStatusMqtt: m,
  // [UNIFIED] covered by domains: deleteMessage: g,
  // [UNIFIED] covered by domains: deleteThread: d,
  // [UNIFIED] covered by domains: editMessage: h,
  // [UNIFIED] covered by domains: getFriendsList: T,
  // [UNIFIED] covered by domains: getMessage: S,
  // [UNIFIED] covered by domains: handleMessageRequest: M,
  // [UNIFIED] covered by domains: markAsDelivered: v,
  // [UNIFIED] covered by domains: markAsRead: I,
  // [UNIFIED] covered by domains: markAsReadAll: R,
  // [UNIFIED] covered by domains: markAsSeen: C,
  // [UNIFIED] covered by domains: removeUserFromGroup: D,
  // [UNIFIED] covered by domains: scheduler: E,
  // [UNIFIED] covered by domains: sendMessage: B,
  // [UNIFIED] covered by domains: unsendMessage: X,
  // [UNIFIED] covered by domains: uploadAttachment: z,
  // [UNIFIED] covered by domains: getUserInfo: Y,
  // [UNIFIED] covered by domains: getUserInfoV2: Z,
  // [UNIFIED] covered by domains: getThreadHistory: $,
  // [UNIFIED] covered by domains: getThreadInfo: ee,
  // [UNIFIED] covered by domains: getThreadList: re,
  // [UNIFIED] covered by domains: getThreadPictures: te,
  // [UNIFIED] covered by domains: enableAutoSaveAppState: _e,
  // [UNIFIED] covered by domains: follow: ge,
  // [UNIFIED] covered by domains: getCurrentUserID: de,
  // [UNIFIED] covered by domains: handleFriendRequest: he,
  // [UNIFIED] covered by domains: logout: le,
  // [UNIFIED] covered by domains: refreshFb_dtsg: ue,
  acpUser: Ue,
  AntiDetection: ye,
  UserAgents: De,
  ws3Compat: Ge,
  mostakimCompat: Ee,
  sendMessageWithRetry: sendMessageWithRetryFactory,
};
var nt = e;
export { e as EXTERNAL_API_FACTORIES, nt as default };

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('./plugin-provider.js').FcaPlugin} */
export const $plugin = {
  name: 'fca-external-apis-index',
  meta: { category: 'external-api-index.js', path: 'lib/external-apis/index.js' },
  setup(_ctx) {
    // provides: EXTERNAL_API_FACTORIES
  },
};
