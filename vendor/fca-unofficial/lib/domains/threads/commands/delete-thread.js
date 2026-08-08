import * as legacy_promise_1 from "../../../compat/legacy-promise.js";
import * as threads_1 from "../../../transport/http/threads.js";
export function createDeleteThreadCommand(deps) {
  const {
    defaultFuncs,
    ctx,
    logError
  } = deps;
  return function deleteThread(threadOrThreads, callback) {
    const {
      callback: cb,
      promise
    } = (0, legacy_promise_1.createLegacyPromise)(callback);
    const threadIDs = Array.isArray(threadOrThreads) ? threadOrThreads : [threadOrThreads];
    (0, threads_1.deleteThreadsViaMercury)({
      defaultFuncs,
      ctx,
      threadIDs
    }).then(response => {
      if (response?.error) {
        throw response;
      }
      cb();
    }).catch(error => {
      logError?.("deleteThread", error);
      cb(error);
    });
    return promise;
  };
}
export default {
  createDeleteThreadCommand
};