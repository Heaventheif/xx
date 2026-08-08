import * as callbackify_1 from "./callbackify.js";
export function createLegacyPromise(callback, fallbackValue) {
  let resolvePromise = () => {};
  let rejectPromise = () => {};
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const legacyCallback = (0, callbackify_1.ensureNodeCallback)((error, data) => {
    if (error) {
      rejectPromise(error);
    } else {
      resolvePromise(data ?? fallbackValue);
    }
    if (typeof callback === "function") {
      callback(error, data);
    }
  });
  return {
    callback: legacyCallback,
    promise
  };
}
export default {
  createLegacyPromise
};