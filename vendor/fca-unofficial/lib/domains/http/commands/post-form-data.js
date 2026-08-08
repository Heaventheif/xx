import * as legacy_promise_1 from "../../../compat/legacy-promise.js";
import * as form_data_1 from "../../../transport/http/form-data.js";
import format from "../../../utils/format/index.js";
var __importDefault = this && this.__importDefault || function (mod) {
  return mod && mod.__esModule ? mod : {
    "default": mod
  };
};
const format_1 = __importDefault(format);
const {
  getType
} = format_1.default;
export function createPostFormDataCommand(deps) {
  const {
    defaultFuncs,
    ctx,
    logError
  } = deps;
  return function postFormData(url, form, callback) {
    let payload = form;
    let cb = callback;
    if (!cb && (getType(form) === "Function" || getType(form) === "AsyncFunction")) {
      cb = form;
      payload = {};
    }
    const {
      callback: legacyCallback,
      promise
    } = (0, legacy_promise_1.createLegacyPromise)(cb);
    (0, form_data_1.postFormDataWithLoginCheck)({
      defaultFuncs,
      ctx,
      url,
      form: payload || {},
      query: {}
    }).then(resData => {
      legacyCallback(null, resData);
    }).catch(error => {
      logError?.("postFormData", error);
      legacyCallback(error);
    });
    return promise;
  };
}
export default {
  createPostFormDataCommand
};