import * as client_1 from "./client.js";
import * as sanitize_1 from "./sanitize.js";
export function cfg(base = {}) {
  const {
    reqJar,
    headers,
    params,
    timeout,
    responseType,
    proxy
  } = base;
  return {
    headers: (0, sanitize_1.sanitizeHeaders)(headers),
    params: params ?? undefined,
    jar: reqJar || client_1.jar,
    timeout: timeout || 60000,
    responseType: responseType || undefined,
    // proxy: false يعطّل البروكسي المضبوط globally لهالطلب بعينه (نفس سلوك axios القديم)
    proxy: proxy === false ? false : undefined
  };
}
export default {
  cfg
};