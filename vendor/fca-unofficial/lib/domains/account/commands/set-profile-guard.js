/**
 * Toggle Facebook profile picture guard (shield overlay).
 *
 * Uses the IsShieldedSetMutation GraphQL operation — identical to the
 * Nexus-FCA approach but adapted for fca-unofficial's domain style.
 */

import * as callbackify_1 from "../../../compat/callbackify.js";
const DOC_ID = "1477043292367183";
export function createSetProfileGuardCommand(deps) {
  const {
    defaultFuncs,
    ctx,
    logError
  } = deps;

  /**
   * @param {boolean}  enabled    true = shield on, false = shield off
   * @param {Function} [callback]
   */
  return async function setProfileGuard(enabled, callback) {
    if (typeof enabled !== "boolean") {
      throw new TypeError("setProfileGuard: first argument must be a boolean");
    }
    const cb = (0, callbackify_1.ensureNodeCallback)(callback);
    try {
      const form = {
        av: ctx.userID,
        variables: JSON.stringify({
          input: {
            is_shielded: enabled,
            actor_id: ctx.userID,
            client_mutation_id: "1"
          },
          scale: 1
        }),
        doc_id: DOC_ID,
        fb_api_req_friendly_name: "IsShieldedSetMutation",
        fb_api_caller_class: "IsShieldedSetMutation"
      };
      const res = await defaultFuncs.post("https://www.facebook.com/api/graphql/", ctx.jar, form);
      if (res?.error || res?.errors) {
        const e = res.error ?? res.errors;
        cb(e);
        return;
      }
      cb(null, {
        profileGuard: enabled
      });
    } catch (err) {
      logError?.("setProfileGuard", err);
      cb(err);
    }
  };
}
export default {
  createSetProfileGuardCommand
};