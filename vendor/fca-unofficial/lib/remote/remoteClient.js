import { createRequire } from "node:module";
import package$0 from "../../package.json" with { type: "json" };
import logger from "../func/logger.js";
const require = createRequire(import.meta.url);
var __importDefault = this && this.__importDefault || function (mod) {
  return mod && mod.__esModule ? mod : {
    "default": mod
  };
};
const ws_1 = __importDefault(require("ws"));
const package_json_1 = __importDefault(package$0);
const logger_1 = __importDefault(logger);
export function createRemoteClient(api, ctx, cfg) {
  if (!cfg || !cfg.enabled || !cfg.url) return null;
  const url = String(cfg.url);
  const token = cfg.token ? String(cfg.token) : null;
  const autoReconnect = cfg.autoReconnect !== false;
  const emitter = ctx && ctx._emitter;
  // SECURITY: this channel lets a remote endpoint push "stop"/"broadcast"
  // events that other code may act on. Refuse to open it without an auth
  // token, and refuse plaintext ws:// to a non-loopback host so the token
  // and any account activity it triggers can't be sniffed on the wire.
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    (0, logger_1.default)(`[remote] invalid remoteControl.url "${url}", refusing to connect`, "error");
    return null;
  }
  if (!token) {
    (0, logger_1.default)("[remote] remoteControl.enabled is true but no token is set — refusing to connect without authentication", "error");
    return null;
  }
  // HIGH-2: Block SSRF — private/link-local ranges must never receive tokens.
  function _isPrivateHost(h) {
    if (!h) return true;
    const lh = h.toLowerCase();
    return lh === "localhost" || lh === "::1" || /^127\./.test(lh) ||
      /^10\./.test(lh) || /^192\.168\./.test(lh) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(lh) ||
      /^169\.254\./.test(lh) || lh === "0.0.0.0";
  }
  const isLoopback = parsedUrl.hostname === "localhost" || parsedUrl.hostname === "127.0.0.1" || parsedUrl.hostname === "::1";
  if (_isPrivateHost(parsedUrl.hostname) && !isLoopback) {
    (0, logger_1.default)(`[remote] remoteControl.url points to a private/link-local address "${parsedUrl.hostname}" — SSRF protection.`, "error");
    return null;
  }
  if (parsedUrl.protocol !== "wss:" && !isLoopback) {
    (0, logger_1.default)(`[remote] remoteControl.url "${parsedUrl.hostname}" is not wss:// — refusing to send the auth token over plaintext ws://`, "error");
    return null;
  }
  let ws = null;
  let closed = false;
  let reconnectTimer = null;
  // MED-2: Exponential backoff — prevents infinite hammering of a dead server.
  // Sequence: 2s, 4s, 8s, 16s, 32s, 60s cap. Gives up after MAX_RETRIES.
  const MAX_RETRIES = 10;
  const BASE_DELAY_MS = 2000;
  const MAX_DELAY_MS = 60_000;
  let _retryCount = 0;
  function log(message, level = "info") {
    (0, logger_1.default)(`[remote] ${message}`, level);
  }
  function scheduleReconnect() {
    if (!autoReconnect || closed) return;
    if (reconnectTimer) return;
    _retryCount++;
    if (_retryCount > MAX_RETRIES) {
      log(`giving up after ${MAX_RETRIES} reconnect attempts`, "error");
      closed = true;
      return;
    }
    const delay = Math.min(BASE_DELAY_MS * Math.pow(2, _retryCount - 1), MAX_DELAY_MS);
    log(`reconnecting in ${Math.round(delay / 1000)}s (attempt ${_retryCount}/${MAX_RETRIES})`, "warn");
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!closed) connect();
    }, delay);
  }
  function safeEmit(event, payload) {
    try {
      if (emitter && typeof emitter.emit === "function") {
        emitter.emit(event, payload);
      }
    } catch {}
  }
  function connect() {
    try {
      ws = new ws_1.default(url, {
        headers: token ? {
          Authorization: `Bearer ${token}`
        } : undefined
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`connect error: ${msg}`, "warn");
      scheduleReconnect();
      return;
    }
    const socket = ws;
    socket.on("open", () => {
      _retryCount = 0; // MED-2: reset backoff on successful connection
      log("connected", "info");
      const payload = {
        type: "hello",
        userID: ctx && ctx.userID,
        region: ctx && ctx.region,
        version: package_json_1.default.version
      };
      try {
        socket.send(JSON.stringify(payload));
      } catch {}
      safeEmit("remoteConnected", payload);
    });
    socket.on("message", data => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") return;
      switch (msg.type) {
        case "ping":
          try {
            socket.send(JSON.stringify({
              type: "pong"
            }));
          } catch {}
          break;
        case "stop":
          safeEmit("remoteStop", msg);
          break;
        case "broadcast":
          safeEmit("remoteBroadcast", msg.payload || {});
          break;
        default:
          safeEmit("remoteMessage", msg);
          break;
      }
    });
    socket.on("close", () => {
      log("disconnected", "warn");
      safeEmit("remoteDisconnected", undefined);
      if (!closed) scheduleReconnect();
    });
    socket.on("error", err => {
      log(`error: ${err && err.message ? err.message : String(err)}`, "warn");
    });
  }
  connect();
  return {
    close() {
      closed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      try {
        if (ws && ws.readyState === ws_1.default.OPEN) {
          ws.close();
        }
      } catch {}
    }
  };
}
export default {
  createRemoteClient
};