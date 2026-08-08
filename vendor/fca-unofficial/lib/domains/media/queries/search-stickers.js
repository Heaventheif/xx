/**
 * Search for Facebook sticker packs by query string.
 * Ported from Nexus-FCA's searchStickers.js.
 */

import * as callbackify_1 from "../../../compat/callbackify.js";
const GRAPHQL_DOC_ID = "1706587639403067";
export function createSearchStickersQuery(deps) {
  const {
    defaultFuncs,
    ctx,
    logError
  } = deps;

  /**
   * @param {string}   query       Search term
   * @param {number}   [limit=20]  Max results per page
   * @param {Function} [callback]
   */
  return async function searchStickers(query, limit = 20, callback) {
    if (typeof limit === "function") {
      callback = limit;
      limit = 20;
    }
    const cb = (0, callbackify_1.ensureNodeCallback)(callback);
    try {
      const form = {
        variables: JSON.stringify({
          query,
          sticker_count: limit,
          sticker_category_ids: [],
          sticker_pack_ids: []
        }),
        doc_id: GRAPHQL_DOC_ID
      };
      const res = await defaultFuncs.post("https://www.facebook.com/api/graphql/", ctx.jar, form);
      if (res?.error || res?.errors) {
        cb(res.error ?? res.errors);
        return;
      }
      const packs = res?.data?.sticker_packs?.edges ?? [];
      const formatted = packs.map(edge => {
        const p = edge.node;
        return {
          packID: p?.id,
          name: p?.name,
          stickers: (p?.stickers?.nodes ?? []).map(s => ({
            stickerID: s?.id,
            label: s?.label,
            url: s?.sprite_image?.uri ?? s?.image?.uri ?? null,
            width: s?.image?.width,
            height: s?.image?.height
          }))
        };
      });
      cb(null, formatted);
    } catch (err) {
      logError?.("searchStickers", err);
      cb(err);
    }
  };
}
export default {
  createSearchStickersQuery
};