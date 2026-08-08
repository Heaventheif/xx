/**
 * Share a URL (with optional metadata preview) in a conversation.
 *
 * Wraps Facebook's message_share_attachment/fromURI endpoint and then
 * sends the share as a message attachment — the same path Nexus uses.
 */

import * as callbackify_1 from "../../../compat/callbackify.js";
export function createShareLinkCommand(deps) {
  const {
    defaultFuncs,
    ctx,
    logError
  } = deps;

  /**
   * @param {string} url            URL to share
   * @param {string} threadID
   * @param {string} [body]         Optional text accompanying the link
   * @param {Function} [callback]
   */
  return async function shareLink(url, threadID, body, callback) {
    if (typeof body === "function") {
      callback = body;
      body = "";
    }
    const cb = (0, callbackify_1.ensureNodeCallback)(callback);
    try {
      // 1. Resolve the link into FB share params
      const form = {
        image_height: 630,
        image_width: 1200,
        uri: url
      };
      const resData = await defaultFuncs.post("https://www.facebook.com/message_share_attachment/fromURI/", ctx.jar, form);
      if (!resData?.payload?.share_data?.share_params) {
        cb({
          error: "shareLink: could not resolve URL metadata"
        });
        return;
      }
      const shareParams = resData.payload.share_data.share_params;

      // 2. Send as a message with attachment
      const msgForm = {
        body: body ?? "",
        has_attachment: true,
        share_params: JSON.stringify(shareParams),
        action_type: "ma-type:user-generated-message",
        thread_fbid: threadID,
        client_tags: JSON.stringify({
          source: "shareLink"
        })
      };
      const sendRes = await defaultFuncs.post("https://www.facebook.com/messaging/send/", ctx.jar, msgForm);
      if (sendRes?.error) {
        cb(sendRes);
        return;
      }
      cb(null, sendRes?.payload);
    } catch (err) {
      logError?.("shareLink", err);
      cb(err);
    }
  };
}
export default {
  createShareLinkCommand
};