import * as client_1 from "../../utils/client.js";
export async function postGraphql(params) {
  const {
    defaultFuncs,
    ctx,
    form,
    url = "https://www.facebook.com/api/graphql/",
    jar = ctx.jar
  } = params;
  return defaultFuncs.post(url, jar, form).then((0, client_1.parseAndCheckLogin)(ctx, defaultFuncs));
}
export async function postGraphqlBatch(params) {
  const {
    defaultFuncs,
    ctx,
    form,
    url = "https://www.facebook.com/api/graphqlbatch/"
  } = params;
  return defaultFuncs.post(url, ctx.jar, form).then((0, client_1.parseAndCheckLogin)(ctx, defaultFuncs));
}
export default {
  postGraphql,
  postGraphqlBatch
};