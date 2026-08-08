import follow from "./api/follow.js";
import setStoryReaction from "./api/setStoryReaction.js";
import changeCover from "./api/changeCover.js";
import changeName from "./api/changeName.js";
import changeUsername from "./api/changeUsername.js";
import changeBlockedStatusMqtt from "./api/changeBlockedStatusMqtt.js";
import createCommentPost from "./api/createCommentPost.js";
import sendComment from "./api/sendComment.js";
import getUID from "./api/getUID.js";
import getBotInitialData from "./api/getBotInitialData.js";
import getAccess from "./api/getAccess.js";
import getCtx from "./api/getCtx.js";
import listenRealtime from "./api/listenRealtime.js";
import listenNotification from "./api/listenNotification.js";
import listenSpeed from "./api/listenSpeed.js";
import threadColors from "./api/threadColors.js";

/**
 * Attach all Nexus extra methods to a vendor api object.
 * Call immediately after login():
 *   login(creds, (err, api) => { attachNexusMethods(api, api._defaultFuncs, api._ctx); });
 */
export function attachNexusMethods(api, defaultFuncs, ctx) {
  api.follow                  = follow(defaultFuncs, api, ctx);
  api.setStoryReaction        = setStoryReaction(defaultFuncs, api, ctx);
  api.changeCover             = changeCover(defaultFuncs, api, ctx);
  api.changeName              = changeName(defaultFuncs, api, ctx);
  api.changeUsername          = changeUsername(defaultFuncs, api, ctx);
  api.changeBlockedStatusMqtt = changeBlockedStatusMqtt(defaultFuncs, api, ctx);
  api.createCommentPost       = createCommentPost(defaultFuncs, api, ctx);
  api.sendComment             = sendComment(defaultFuncs, api, ctx);
  api.getUID                  = getUID(defaultFuncs, api, ctx);
  api.getBotInitialData       = getBotInitialData(defaultFuncs, api, ctx);
  api.getAccess               = getAccess(defaultFuncs, api, ctx);
  api.getCtx                  = getCtx(defaultFuncs, api, ctx);
  api.listenRealtime          = listenRealtime(defaultFuncs, api, ctx);
  api.listenNotification      = listenNotification(defaultFuncs, api, ctx);
  api.listenSpeed             = listenSpeed(defaultFuncs, api, ctx);
  api.threadColors            = threadColors;
  return api;
}

export {
  follow, setStoryReaction, changeCover, changeName, changeUsername,
  changeBlockedStatusMqtt, createCommentPost, sendComment,
  getUID, getBotInitialData, getAccess, getCtx,
  listenRealtime, listenNotification, listenSpeed, threadColors,
};
