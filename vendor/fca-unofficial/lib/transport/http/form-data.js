import * as client_1 from "../../utils/client.js";
export async function postFormDataWithLoginCheck(params) {
  const {
    defaultFuncs,
    ctx,
    url,
    form,
    query = {}
  } = params;
  return defaultFuncs.postFormData(url, ctx.jar, form, query).then((0, client_1.parseAndCheckLogin)(ctx, defaultFuncs));
}
export default {
  postFormDataWithLoginCheck
};