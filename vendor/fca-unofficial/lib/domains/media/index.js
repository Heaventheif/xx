/**
 * Media domain — post creation, sticker search, and related media ops.
 */

import * as create_post_1 from "./commands/create-post.js";
import * as search_stickers_1 from "./queries/search-stickers.js";
function compactNamespace(ns) {
  return Object.fromEntries(Object.entries(ns).filter(([, v]) => v !== undefined));
}
export function createMediaDomain(deps) {
  return compactNamespace({
    createPost: deps.createPost ? (0, create_post_1.createCreatePostCommand)(deps.createPost) : undefined,
    searchStickers: deps.searchStickers ? (0, search_stickers_1.createSearchStickersQuery)(deps.searchStickers) : undefined
  });
}
export * from "./commands/create-post.js";
export * from "./queries/search-stickers.js";
export default {
  createMediaDomain
};