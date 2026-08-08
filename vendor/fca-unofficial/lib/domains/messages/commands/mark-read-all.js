import * as legacy_promise_1 from "../../../compat/legacy-promise.js";
import * as mercury_1 from "../../../transport/http/mercury.js";
export function createMarkReadAllCommand(deps) {
  const {
    defaultFuncs,
    ctx,
    logError
  } = deps;
  return function markAsReadAll(callback) {
    const {
      callback: cb,
      promise
    } = (0, legacy_promise_1.createLegacyPromise)(callback);
    (0, mercury_1.markFolderAsReadViaMercury)({
      defaultFuncs,
      ctx
    }).then(response => {
      if (response?.error) {
        throw response;
      }
      cb();
    }).catch(error => {
      logError?.("markAsReadAll", error);
      cb(error);
    });
    return promise;
  };
}
export default {
  createMarkReadAllCommand
};