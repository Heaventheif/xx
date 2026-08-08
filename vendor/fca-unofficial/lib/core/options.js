import logger from "../func/logger.js";
import * as request_1 from "../utils/request/index.js";
var __importDefault = this && this.__importDefault || function (mod) {
  return mod && mod.__esModule ? mod : {
    "default": mod
  };
};
const logger_1 = __importDefault(logger);
export const Boolean_Option = ["online", "selfListen", "listenEvents", "updatePresence", "forceLogin", "autoMarkRead", "listenTyping", "autoReconnect", "emitReady", "selfListenEvent"];
export function setOptions(globalOptions, options = {}) {
  for (const key of Object.keys(options || {})) {
    if (Boolean_Option.includes(key)) {
      globalOptions[key] = Boolean(options[key]);
      continue;
    }
    switch (key) {
      case "userAgent":
        {
          globalOptions.userAgent = options.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
          break;
        }
      case "proxy":
        {
          if (typeof options.proxy !== "string") {
            delete globalOptions.proxy;
            (0, request_1.setProxy)();
          } else {
            globalOptions.proxy = options.proxy;
            (0, request_1.setProxy)(globalOptions.proxy);
          }
          break;
        }
      default:
        {
          (0, logger_1.default)("setOptions Unrecognized option given to setOptions: " + key, "warn");
          break;
        }
    }
  }
}
export default {
  setOptions,
  Boolean_Option
};