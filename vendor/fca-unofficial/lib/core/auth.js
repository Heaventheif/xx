import logger from "../func/logger.js";
import format from "../utils/format/index.js";
import * as state_1 from "./state.js";
import * as request_1 from "./request.js";
import * as options_1 from "./options.js";
import * as config_1 from "./config.js";
import * as update_check_1 from "./update-check.js";
import loginHelper from "./login-helper.js";
var __importDefault = this && this.__importDefault || function (mod) {
  return mod && mod.__esModule ? mod : {
    "default": mod
  };
};
const logger_1 = __importDefault(logger);
const format_1 = __importDefault(format);
const login_helper_1 = __importDefault(loginHelper);
const {
  getType
} = format_1.default;
const g = global;
const initialConfig = (0, config_1.loadConfig)().config;
g.fca = g.fca || {};
g.fca.config = initialConfig;
// SECURITY / DESIGN (CVE-FCA-03, Medium): these are process-wide listeners —
// they run for the *entire host application* that imports this library, not
// just this library's own code. The previous "uncaughtException" handler
// logged literally every unrecognized error and then let execution continue
// no matter what. Per Node's own docs, resuming "normal operation" after an
// uncaughtException is unsafe: the process may be in an undefined state
// (partially-completed I/O, corrupted in-memory structures), and silently
// carrying on can mask a critical bug — in this library *or* in the host
// app — indefinitely instead of surfacing it.
//
// Fix: keep swallowing the specific, well-understood transient patterns this
// long-lived bot process legitimately sees a lot of (network blips, a known
// benign Sequelize compat warning). For anything else — genuinely unexpected
// errors — log it clearly as fatal, give any registered flush hooks (e.g.
// pending DB writes) a chance to finish, and exit rather than limp along in
// an unknown state. This can be disabled via `crashOnUnknownError: false` in
// fca-config.json for hosts that have their own top-level handler and want
// to manage this themselves — but that is an explicit opt-out, not the
// silent default.
const KNOWN_BENIGN_PATTERNS = [
  { test: (msg) => msg.includes("No Sequelize instance passed"), label: "benign compat warning" },
];
const KNOWN_TRANSIENT_CODES = new Set(["UND_ERR_CONNECT_TIMEOUT", "ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "ECONNRESET"]);
const KNOWN_TRANSIENT_MESSAGE_RE = /Connect Timeout|fetch failed|ECONNREFUSED|ENOTFOUND/;
function classifyProcessError(err) {
  const message = (err && (err.message || String(err))) || "";
  const code = err && err.code;
  for (const p of KNOWN_BENIGN_PATTERNS) {
    if (p.test(message)) return { action: "ignore", message };
  }
  if ((code && KNOWN_TRANSIENT_CODES.has(code)) || KNOWN_TRANSIENT_MESSAGE_RE.test(message)) {
    return { action: "warn", message };
  }
  return { action: "fatal", message };
}
async function flushBeforeExit() {
  try {
    for (const hook of g.fca._flushHooks || []) {
      try { await hook(); } catch {}
    }
  } catch {}
}
if (!g.fca._errorHandlersInstalled) {
  g.fca._errorHandlersInstalled = true;
  g.fca._flushHooks = g.fca._flushHooks || [];
  process.on("unhandledRejection", reason => {
    try {
      const { action, message } = classifyProcessError(reason);
      if (action === "ignore") return;
      const level = action === "warn" ? "warn" : "error";
      (0, logger_1.default)(`Unhandled promise rejection (non-fatal): ${message}`, level);
    } catch {}
  });
  process.on("uncaughtException", error => {
    try {
      const config = g.fca.config || {};
      const { action, message } = classifyProcessError(error);
      if (action === "ignore") return;
      if (action === "warn") {
        (0, logger_1.default)(`Uncaught network error caught (non-fatal): ${message}`, "warn");
        return;
      }
      (0, logger_1.default)(`Uncaught exception (fatal, unrecognized — process will exit): ${message}`, "error");
      if (config.crashOnUnknownError === false) {
        (0, logger_1.default)("crashOnUnknownError=false — continuing despite unrecognized error. " + "This is not recommended: the process may be in an undefined state.", "warn");
        return;
      }
      flushBeforeExit().finally(() => process.exit(1));
    } catch {
      process.exit(1);
    }
  });
}
function appStateToCookieString(appState) {
  if (!Array.isArray(appState)) return "";
  return appState.map(c => {
    const key = c?.key || c?.name;
    const value = c?.value;
    if (!key || value === undefined || value === null) return null;
    return `${key}=${value}`;
  }).filter(Boolean).join("; ");
}
function appStateToFbid(appState) {
  if (!Array.isArray(appState)) return "";
  const cUser = appState.find(c => c?.key === "c_user" || c?.name === "c_user");
  const iUser = appState.find(c => c?.key === "i_user" || c?.name === "i_user");
  return String(cUser && cUser.value || iUser && iUser.value || "");
}
const DEFAULT_LOGIN_OPTIONS = {
  selfListen: false,
  selfListenEvent: false,
  listenEvents: false,
  listenTyping: false,
  updatePresence: false,
  forceLogin: false,
  autoMarkRead: false,
  autoReconnect: true,
  online: true,
  emitReady: false,
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
};
export async function loginAsync(credentials, customOptions = {}) {
  const {
    config
  } = (0, config_1.loadConfig)();
  g.fca = g.fca || {};
  g.fca.config = config;
  const ctx = (0, state_1.createDefaultContext)();
  const globalOptions = {
    ...DEFAULT_LOGIN_OPTIONS
  };
  (0, options_1.setOptions)(globalOptions, customOptions || {});
  ctx.options = {
    ...ctx.options,
    ...globalOptions
  };
  ctx.globalOptions = globalOptions;
  ctx.cookieString = appStateToCookieString(credentials.appState);
  ctx.fbid = appStateToFbid(credentials.appState);
  ctx._request = (0, request_1.createRequestHelper)(ctx);
  const runLogin = () => new Promise((resolve, reject) => {
    (0, login_helper_1.default)(credentials.appState, credentials.Cookie, credentials.email, credentials.password, globalOptions, (error, api) => {
      if (error) return reject(error);
      return resolve(api);
    });
  });
  let api;
  if (config.checkUpdate.enabled) {
    await (0, update_check_1.runConfiguredUpdateCheck)(config, logger_1.default);
  }
  api = await runLogin();
  ctx.api = api;
  try {
    if (typeof api.getCurrentUserID === "function") {
      ctx.fbid = String(api.getCurrentUserID() || ctx.fbid || "");
      ctx.userID = ctx.fbid;
    }
    if (typeof api.getCookies === "function") {
      ctx.cookieString = String(api.getCookies() || ctx.cookieString || "");
    }
  } catch {}
  return ctx;
}
export function login(credentials, optionsOrCallback, callback) {
  if (typeof optionsOrCallback === "function") {
    const cb = optionsOrCallback;
    void loginAsync(credentials, {}).then(ctx => {
      cb(null, ctx.api);
    }).catch(err => {
      cb(err instanceof Error ? err : new Error(String(err?.message ?? err)));
    });
    return;
  }
  if (typeof callback === "function") {
    const opts = optionsOrCallback || {};
    void loginAsync(credentials, opts).then(ctx => {
      callback(null, ctx.api);
    }).catch(err => {
      callback(err instanceof Error ? err : new Error(String(err?.message ?? err)));
    });
    return;
  }
  return loginAsync(credentials, optionsOrCallback || {});
}
export function loginLegacy(credentials, options, callback) {
  if (getType(options) === "Function" || getType(options) === "AsyncFunction") {
    callback = options;
    options = {};
  }
  const p = loginAsync(credentials, options || {});
  if (typeof callback === "function") {
    p.then(res => callback?.(null, res)).catch(err => callback?.(err));
    return;
  }
  return p;
}
export const tokensViaAPI = (email, password, twoFactor, apiBaseUrl) => login_helper_1.default.tokensViaAPI(email, password, twoFactor, apiBaseUrl);
export const loginViaAPI = (email, password, twoFactor, apiBaseUrl, apiKey) => login_helper_1.default.loginViaAPI(email, password, twoFactor, apiBaseUrl, apiKey);
export const normalizeCookieHeaderString = cookieHeader => login_helper_1.default.normalizeCookieHeaderString(cookieHeader);
export const setJarFromPairs = (jar, pairs, domain) => login_helper_1.default.setJarFromPairs(jar, pairs, domain);
export default login;