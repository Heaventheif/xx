import * as legacy_promise_1 from "../../../compat/legacy-promise.js";
import * as threads_1 from "../../../transport/http/threads.js";
export function createMuteThreadCommand(deps) {
  const {
    defaultFuncs,
    ctx,
    logError
  } = deps;
  return function muteThread(threadID, muteSeconds, callback) {
    const {
      callback: cb,
      promise
    } = (0, legacy_promise_1.createLegacyPromise)(callback);
    (0, threads_1.changeThreadMuteViaMercury)({
      defaultFuncs,
      ctx,
      threadID,
      muteSeconds
    }).then(response => {
      if (response?.error) {
        throw response;
      }
      cb();
    }).catch(error => {
      logError?.("muteThread", error);
      cb(error);
    });
    return promise;
  };
}
export default {
  createMuteThreadCommand
};