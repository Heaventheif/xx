/**
 * Create a Facebook post (timeline or group).
 * Ported from Nexus-FCA's createPost.js, adapted for fca-unofficial.
 */

import * as callbackify_1 from "../../../compat/callbackify.js";
export function createCreatePostCommand(deps) {
  const {
    defaultFuncs,
    ctx,
    logError
  } = deps;

  /**
   * @param {object}   post
   * @param {string}   post.body          Post text content
   * @param {string}   [post.targetID]    Target page/group ID (defaults to own timeline)
   * @param {'PUBLIC'|'FRIENDS'|'ONLY_ME'} [post.privacy='PUBLIC']
   * @param {Function} [callback]
   */
  return async function createPost(post, callback) {
    if (typeof post === "string") post = {
      body: post
    };
    const cb = (0, callbackify_1.ensureNodeCallback)(callback);
    try {
      const form = {
        fb_api_caller_class: "RelayModern",
        fb_api_req_friendly_name: "ComposerStoryCreateMutation",
        variables: JSON.stringify({
          input: {
            audience: {
              privacy: {
                allow: [],
                base_state: post.privacy ?? "EVERYONE",
                deny: [],
                tag_expansion_state: "UNSPECIFIED"
              }
            },
            message: {
              text: post.body ?? ""
            },
            with_tags_input_data: {
              composer_type: "timeline"
            },
            actor_id: post.targetID ?? ctx.userID,
            client_mutation_id: String(Math.floor(Math.random() * 1e6))
          }
        }),
        doc_id: "5496903790364605"
      };
      const res = await defaultFuncs.post("https://www.facebook.com/api/graphql/", ctx.jar, form);
      if (res?.error || res?.errors) {
        cb(res.error ?? res.errors);
        return;
      }
      cb(null, res?.data ?? res?.payload ?? null);
    } catch (err) {
      logError?.("createPost", err);
      cb(err);
    }
  };
}
export default {
  createCreatePostCommand
};