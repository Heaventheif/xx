import * as http_get_1 from "./queries/http-get.js";
import * as http_post_1 from "./commands/http-post.js";
import * as post_form_data_1 from "./commands/post-form-data.js";
export function createHttpDomain(deps) {
  return {
    get: (0, http_get_1.createHttpGetQuery)(deps.get),
    post: (0, http_post_1.createHttpPostCommand)(deps.post),
    postFormData: (0, post_form_data_1.createPostFormDataCommand)(deps.postFormData)
  };
}
export * from "./queries/http-get.js";
export * from "./commands/http-post.js";
export * from "./commands/post-form-data.js";
export default {
  createHttpDomain
};