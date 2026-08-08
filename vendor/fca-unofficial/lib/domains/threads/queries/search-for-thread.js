import * as legacy_promise_1 from "../../../compat/legacy-promise.js";
import * as threads_1 from "../../../transport/http/threads.js";
import format from "../../../utils/format/index.js";
var __importDefault = this && this.__importDefault || function (mod) {
  return mod && mod.__esModule ? mod : {
    "default": mod
  };
};
const format_1 = __importDefault(format);
const {
  formatThread
} = format_1.default;
export function createSearchForThreadQuery(deps) {
  const {
    defaultFuncs,
    ctx,
    logError
  } = deps;
  return function searchForThread(name, callback) {
    const {
      callback: cb,
      promise
    } = (0, legacy_promise_1.createLegacyPromise)(callback, []);
    (0, threads_1.searchThreadsViaMercury)({
      defaultFuncs,
      ctx,
      query: name
    }).then(response => {
      if (response?.error) {
        throw response;
      }
      const threads = response?.payload?.mercury_payload?.threads;
      if (!Array.isArray(threads)) {
        cb({
          error: `Could not find thread \`${name}\`.`
        });
        return;
      }
      cb(null, threads.map(thread => formatThread(thread)));
    }).catch(error => {
      logError?.("searchForThread", error);
      cb(error);
    });
    return promise;
  };
}
export default {
  createSearchForThreadQuery
};