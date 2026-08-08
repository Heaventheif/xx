/**
 * Follow / unfollow a Facebook user.
 *
 * Uses Facebook's graph subscribe endpoint, identical to the approach
 * in Nexus-FCA's follow.js but adapted to fca-unofficial's domain style.
 */

import * as callbackify_1 from "../../../compat/callbackify.js";
export function createFollowCommand(deps) {
  const {
    defaultFuncs,
    ctx,
    logError
  } = deps;

  /**
   * @param {string}   userID     Target user to follow/unfollow
   * @param {boolean}  [follow=true]  true = follow, false = unfollow
   * @param {Function} [callback]
   */
  return async function follow(userID, follow = true, callback) {
    if (typeof follow === "function") {
      callback = follow;
      follow = true;
    }
    const cb = (0, callbackify_1.ensureNodeCallback)(callback);
    try {
      const endpoint = follow ? `https://www.facebook.com/${userID}/followers/add_follower/` : `https://www.facebook.com/${userID}/followers/remove_follower/`;
      const form = {
        nctr: JSON.stringify({
          _mod: "pagelet_timeline_app_collection_followers_more"
        }),
        __user: ctx.userID,
        __a: "1"
      };
      const res = await defaultFuncs.post(endpoint, ctx.jar, form);
      if (res?.error) {
        cb(res);
        return;
      }
      cb(null, {
        following: follow,
        userID
      });
    } catch (err) {
      logError?.("follow", err);
      cb(err);
    }
  };
}
export default {
  createFollowCommand
};