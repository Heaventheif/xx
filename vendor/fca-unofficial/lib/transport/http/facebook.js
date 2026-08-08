import * as client_1 from "../../utils/client.js";
export async function getWithLoginCheck(params) {
  const {
    defaultFuncs,
    ctx,
    url,
    form = null
  } = params;
  return defaultFuncs.get(url, ctx.jar, form || undefined).then((0, client_1.parseAndCheckLogin)(ctx, defaultFuncs));
}
export async function postWithLoginCheck(params) {
  const {
    defaultFuncs,
    ctx,
    url,
    form = {}
  } = params;
  return defaultFuncs.post(url, ctx.jar, form).then((0, client_1.parseAndCheckLogin)(ctx, defaultFuncs));
}
export async function postAndSaveCookies(params) {
  const {
    defaultFuncs,
    ctx,
    url,
    form = {}
  } = params;
  return defaultFuncs.post(url, ctx.jar, form).then((0, client_1.saveCookies)(ctx.jar));
}
export async function postWithSavedCookiesAndLoginCheck(params) {
  const {
    defaultFuncs,
    ctx,
    url,
    form = {}
  } = params;
  return defaultFuncs.post(url, ctx.jar, form).then((0, client_1.saveCookies)(ctx.jar)).then((0, client_1.parseAndCheckLogin)(ctx, defaultFuncs));
}
export async function getAndSaveCookies(params) {
  const {
    defaultFuncs,
    ctx,
    url,
    form = {}
  } = params;
  return defaultFuncs.get(url, ctx.jar, form).then((0, client_1.saveCookies)(ctx.jar));
}
export default {
  getWithLoginCheck,
  postWithLoginCheck,
  postAndSaveCookies,
  postWithSavedCookiesAndLoginCheck,
  getAndSaveCookies
};