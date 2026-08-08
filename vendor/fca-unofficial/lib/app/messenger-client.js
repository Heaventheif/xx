/**
 * MessengerClient — enhanced OOP wrapper inspired by Nexus-FCA's NexusClient.
 *
 * Combines the clean domain-based facade from fca-unofficial's `MessengerBot`
 * with Nexus-FCA's high-level convenience API:
 *  - EventEmitter-based event routing (message, reaction, typing, ready, …)
 *  - Telegraf-style middleware + .command() / .hears()
 *  - Built-in CommandRegistry integration
 *  - Optional SessionGuard, CookieRefresher, HealthMetrics, HealthServer
 *  - Parallel send queue (up to N concurrent MQTT sends)
 *
 * Usage:
 *
 *   import { login } from "fca-unofficial";
 *   import { MessengerClient } from "fca-unofficial/lib/app/messenger-client.js";
 *
 *   login({ appState }, async (err, api) => {
 *     const client = new MessengerClient(api, { commandPrefix: "!" });
 *     client.on("message", (msg) => { ... });
 *     await client.start();
 *   });
 */

import node_events_1 from "node:events";
import * as create_client_1 from "./create-client.js";
import * as messenger_bot_1 from "./messenger-bot.js";
import registry_1 from "../command/registry.js";
import session_guard_1 from "../safety/session-guard.js";
import cookie_refresher_1 from "../safety/cookie-refresher.js";
import health_metrics_1 from "../performance/health-metrics.js";
import health_server_1 from "../performance/health-server.js";
const EventEmitter = node_events_1.default ?? node_events_1;
const {
  CommandRegistry,
  Command
} = registry_1;
const {
  createSessionGuard
} = session_guard_1;
const {
  createCookieRefresher
} = cookie_refresher_1;
const {
  createHealthMetrics
} = health_metrics_1;
const {
  createHealthServer
} = health_server_1;
// Use the MessengerBot class directly (not createMessengerBot/connect, which
// performs a brand-new login). MessengerClient already receives an
// authenticated `api`, so the bot must be constructed from it synchronously.
const {
  MessengerBot
} = messenger_bot_1;
const DEFAULT_MAX_PARALLEL = 5;
export class MessengerClient extends EventEmitter {
  /**
   * @param {object} api       Raw fca-unofficial API object returned by `login`
   * @param {object} [options]
   * @param {string}  [options.commandPrefix="/"]
   * @param {string[]} [options.ownerIDs=[]]
   * @param {number}  [options.maxParallelSends=5]
   * @param {boolean} [options.healthServer=false]
   * @param {number}  [options.healthServerPort]
   * @param {boolean} [options.cookieRefresher=true]
   * @param {string}  [options.appStatePath]
   * @param {boolean} [options.sessionGuard=true]
   */
  constructor(api, options = {}) {
    super();
    this.setMaxListeners(0);
    this.api = api;
    this.options = options;

    /** Ergonomic domain facade (client.messages.send, client.threads.getInfo, …) */
    this.client = (0, create_client_1.createFcaClient)(api);

    /** Telegraf-style middleware bot (handles routing + .command() / .hears()) */
    this._bot = new MessengerBot({
      api,
      ...(api._ctx ?? {})
    }, {
      commandPrefix: options.commandPrefix ?? "/",
      maxEventListeners: 0,
      enableComposer: true,
      stopOnSignals: options.stopOnSignals ?? false
    });

    /** CommandRegistry for structured command dispatch */
    this.commands = new CommandRegistry({
      prefix: options.commandPrefix ?? "/",
      ownerIDs: options.ownerIDs ?? []
    });

    /** Health & telemetry */
    this.metrics = createHealthMetrics();
    if (options.healthServer) {
      this._healthServer = createHealthServer({
        port: options.healthServerPort
      });
      this._healthServer.attachMetrics(this.metrics);
    }

    /** Safety */
    if (options.sessionGuard !== false) {
      this._sessionGuard = createSessionGuard();
    }
    if (options.cookieRefresher !== false && api._defaultFuncs) {
      this._cookieRefresher = createCookieRefresher({
        appStatePath: options.appStatePath,
        intervalMs: options.cookieRefreshIntervalMs
      });
    }

    /** Parallel send queue */
    this._maxParallel = options.maxParallelSends ?? DEFAULT_MAX_PARALLEL;
    /** @type {Array<{msg: object, threadID: string, resolve: Function, reject: Function}>} */
    this._sendQueue = [];
    this._activeSends = 0;

    /** Stop handle returned by listenMqtt */
    this._stopHandle = null;
    this._forwardBotEvents();
  }

  // ── public API ────────────────────────────────────────────────────────────

  /**
   * Start listening for events. Resolves once the "ready" event fires.
   */
  async start() {
    // Safety modules
    if (this._sessionGuard && this.api._ctx) {
      this._sessionGuard.attach(this.api._ctx, {
        onStale: ctx => this.emit("stale", ctx)
      });
    }
    if (this._cookieRefresher && this.api._defaultFuncs) {
      this._cookieRefresher.attach(this.api._ctx, this.api._defaultFuncs);
    }
    if (this._healthServer) {
      this._healthServer.start();
    }
    return new Promise(resolve => {
      this._stopHandle = this.api.listenMqtt((err, event) => {
        if (err) {
          this.emit("error", err);
          return;
        }
        this._sessionGuard?.heartbeat();
        this.metrics.onMessage();
        this._routeEvent(event);
      });
      this.once("ready", resolve);
      // fire a synthetic ready if the API doesn't emit one quickly
      setTimeout(() => resolve(), 3000);
    });
  }

  /** Gracefully stop listening and clean up timers. */
  async stop() {
    this._stopHandle?.();
    this._cookieRefresher?.stop();
    this._sessionGuard?.stop();
    this._healthServer?.stop();
    this.emit("stop");
  }

  // ── messaging ─────────────────────────────────────────────────────────────

  /**
   * Send a message, respecting the parallel-send limit.
   * Returns a Promise<messageInfo>.
   */
  send(msg, threadID) {
    return new Promise((resolve, reject) => {
      this._sendQueue.push({
        msg,
        threadID,
        resolve,
        reject
      });
      this._drainQueue();
    });
  }

  /** Reply to a specific message. */
  reply(msg, event) {
    if (typeof msg === "string") msg = {
      body: msg
    };
    return this.send({
      ...msg,
      replyMessageID: event.messageID
    }, event.threadID);
  }

  /** React to a message. */
  react(reaction, messageID) {
    return new Promise((resolve, reject) => {
      this.api.setMessageReaction(reaction, messageID, err => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  /** Unsend a message (must be your own). */
  unsend(messageID) {
    return new Promise((resolve, reject) => {
      this.api.unsendMessage(messageID, err => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  /** Pin or unpin a message. */
  pin(pin, messageID, threadID) {
    return new Promise((resolve, reject) => {
      const fn = this.api.pinMessage;
      if (typeof fn !== "function") return reject(new Error("pinMessage not available"));
      fn(pin, messageID, threadID, (err, res) => {
        if (err) return reject(err);
        resolve(res);
      });
    });
  }

  // ── middleware / command routing ──────────────────────────────────────────

  /**
   * Add a global middleware (Telegraf-style `use`).
   * `ctx` has: api, threadID, senderID, body, event, reply().
   */
  use(middleware) {
    this._bot.use(middleware);
    return this;
  }

  /** Register a text command handler via the built-in CommandRegistry. */
  command(name, handler, options = {}) {
    // Build & register the Command
    const cmd = new Command(name, {
      ...options,
      handler
    });
    this.commands.register(cmd);
    // Also add to bot middleware for Telegraf-style .command() routing
    this._bot.command(name, async ctx => {
      const parts = (ctx.text ?? "").trim().split(/\s+/);
      const args = parts.slice(1);
      await handler({
        ...ctx,
        args
      });
    });
    return this;
  }

  /** Pattern-based hears handler. */
  hears(pattern, handler) {
    this._bot.hears(pattern, handler);
    return this;
  }

  // ── introspection ─────────────────────────────────────────────────────────

  getMetrics() {
    return this.metrics.snapshot();
  }

  // ── private ───────────────────────────────────────────────────────────────

  _routeEvent(event) {
    if (!event) return;
    this.emit("update", event);
    this.emit("raw", event);
    const t = event.type;
    if (!t) return;
    if (t === "message" || t === "message_reply") {
      this.metrics.onMessage();
      this.emit("message", event);
      this.emit("messageCreate", event);
      // CommandRegistry dispatch
      const text = event.body ?? "";
      const perms = [];
      this.commands.dispatch(text, {
        senderID: event.senderID,
        isGroup: !!event.isGroup,
        api: this.api,
        threadID: event.threadID,
        messageID: event.messageID,
        event
      }, perms).catch(err => this.emit("error", err));
    }
    if (t === "message_reply") this.emit("message_reply", event);
    if (t === "message_reaction") this.emit("reaction", event);
    if (t === "message_unsend") this.emit("unsend", event);
    if (t === "typ") this.emit(event.isTyping ? "typingStart" : "typingStop", event);
    if (t === "read_receipt") this.emit("readReceipt", event);
    if (t === "event") this.emit("threadUpdate", event);
    if (t === "ready") {
      this.metrics.onConnect();
      this.emit("ready", event);
    }
    if (t !== "message" && t !== "message_reply") this.emit(t, event);
  }
  _forwardBotEvents() {
    // Forward all MessengerBot events through MessengerClient
    const EVENTS = ["message", "messageCreate", "message_reply", "reaction", "unsend", "typingStart", "typingStop", "threadUpdate", "ready", "error"];
    for (const ev of EVENTS) {
      this._bot.on(ev, data => {
        if (!this.listenerCount(ev)) return;
        this.emit(ev, data);
      });
    }
  }
  _drainQueue() {
    while (this._activeSends < this._maxParallel && this._sendQueue.length > 0) {
      const {
        msg,
        threadID,
        resolve,
        reject
      } = this._sendQueue.shift();
      this._activeSends++;
      this.api.sendMessage(msg, threadID, (err, info) => {
        this._activeSends--;
        if (err) reject(err);else resolve(info);
        this._drainQueue();
      });
    }
  }
}
export function createMessengerClient(api, options) {
  return new MessengerClient(api, options);
}
export default {
  createMessengerClient,
  MessengerClient
};