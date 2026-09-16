/**
 * messenger-bot.js — واجهة البوت العالية المستوى.
 *
 * يوفر:
 *  - نظام middleware (use, command, hears, dm, group)
 *  - أحداث Gateway مطابِقة لنمط Discord.js
 *  - إيقاف متحكَّم به عبر SIGINT/SIGTERM
 */
import EventEmitter        from 'node:events';
import { login }           from '../core/auth.js';
import { createFcaClient } from './create-client.js';
import { MessengerContext } from './messenger-context.js';

// ── أدوات الأحداث ─────────────────────────────────────────────────

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function emitIfListened(emitter, event, data) {
  if (emitter.listenerCount(event) > 0) emitter.emit(event, data);
}

function dispatchGatewayEvent(emitter, event) {
  emitIfListened(emitter, 'update', event);
  emitIfListened(emitter, 'raw',    event);

  const type = event.type;
  if (!type) return;

  if (type === 'message' || type === 'message_reply') {
    emitIfListened(emitter, 'message',       event);
    emitIfListened(emitter, 'messageCreate', event);
  }
  if (type === 'message_reply') emitIfListened(emitter, 'message_reply', event);
  else if (type !== 'message') emitIfListened(emitter, type, event);

  switch (type) {
    case 'message_reaction': emitIfListened(emitter, 'messageReactionAdd', event); break;
    case 'message_unsend':   emitIfListened(emitter, 'messageDelete',      event); break;
    case 'typ':              emitIfListened(emitter, event.isTyping ? 'typingStart' : 'typingStop', event); break;
    case 'event':            emitIfListened(emitter, 'threadUpdate',  event); break;
    case 'ready':
      emitIfListened(emitter, 'ready',      event);
      emitIfListened(emitter, 'shardReady', event);
      break;
  }
}

// ── MessengerBot ───────────────────────────────────────────────────

export class MessengerBot extends EventEmitter {
  /**
   * @param {object} ctx    - سياق FCA (من loginAsync)
   * @param {object} [opts]
   * @param {boolean} [opts.enableComposer=true]
   * @param {string}  [opts.commandPrefix='/']
   * @param {boolean} [opts.stopOnSignals=false]
   * @param {number}  [opts.maxEventListeners=64]
   */
  constructor(ctx, opts = {}) {
    super();

    const maxListeners = opts.maxEventListeners ?? 64;
    this.setMaxListeners(maxListeners === 0 ? 0 : maxListeners);

    this.ctx = ctx;
    this.api = ctx.api;

    this._facade         = null;
    this._mqtt           = null;
    this._listening      = false;
    this._middlewares    = [];
    this._catchHandler   = null;
    this._signalsBound   = false;
    this._onStopSignal   = null;
    this._enableComposer = opts.enableComposer ?? true;
    this._commandPrefix  = opts.commandPrefix  ?? '/';
    this._stopOnSignals  = opts.stopOnSignals   ?? false;
  }

  // ── خصائص ─────────────────────────────────────────────────────

  get commandPrefix()    { return this._commandPrefix; }
  set commandPrefix(val) { this._commandPrefix = val || '/'; }

  get client() {
    if (!this._facade) this._facade = createFcaClient(this.api);
    return this._facade;
  }

  // ── middleware ─────────────────────────────────────────────────

  use(fn) { this._middlewares.push(fn); return this; }

  command(name, handler) {
    const lowerName = name.toLowerCase();
    return this.use(async (ctx, next) => {
      const text = ctx.text;
      if (!text) return next();
      const prefixPattern = escapeRegex(this._commandPrefix);
      const matches = new RegExp(`^${prefixPattern}${escapeRegex(lowerName)}(?:\\s|$)`, 'i').test(text);
      return matches ? handler(ctx) : next();
    });
  }

  hears(pattern, handler) {
    const matches = typeof pattern === 'string'
      ? (text) => text.toLowerCase().includes(pattern.toLowerCase())
      : (text) => pattern.test(text);
    return this.use(async (ctx, next) => {
      const text = ctx.text;
      return (text && matches(text)) ? handler(ctx) : next();
    });
  }

  dm(fn) {
    return this.use(async (ctx, next) => ctx.isDM ? fn(ctx, next) : next());
  }

  group(fn) {
    return this.use(async (ctx, next) => ctx.isGroup ? fn(ctx, next) : next());
  }

  catch(fn) { this._catchHandler = fn; return this; }

  // ── تشغيل وإيقاف ──────────────────────────────────────────────

  startListening() {
    if (this._listening) return this;

    if (typeof this.api.listenMqtt !== 'function') {
      throw new Error('listenMqtt is not available on API');
    }

    const mqtt      = this.api.listenMqtt.call(this.api);
    this._mqtt      = mqtt;
    this._listening = true;

    mqtt.on('message', (event) => {
      dispatchGatewayEvent(this, event);
      this._enqueueComposer(event);
    });

    mqtt.on('error', (err) => this.emit('error', err));

    return this;
  }

  async launch(opts) {
    this.startListening();
    if (opts?.stopOnSignals ?? this._stopOnSignals) this.attachStopSignals();
    return this;
  }

  attachStopSignals() {
    if (this._signalsBound) return;
    this._signalsBound = true;
    this._onStopSignal = () => {
      this.stop()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    };
    process.once('SIGINT',  this._onStopSignal);
    process.once('SIGTERM', this._onStopSignal);
  }

  detachStopSignals() {
    if (!this._signalsBound || !this._onStopSignal) return;
    process.off('SIGINT',  this._onStopSignal);
    process.off('SIGTERM', this._onStopSignal);
    this._signalsBound = false;
    this._onStopSignal = null;
  }

  async stop() {
    this.detachStopSignals();
    if (!this._mqtt) return;

    const mqtt = this._mqtt;
    if (typeof mqtt.stopListeningAsync === 'function') await mqtt.stopListeningAsync();
    else mqtt.stopListening?.();

    mqtt.removeAllListeners?.();
    this._mqtt      = null;
    this._listening = false;
  }

  // ── تشغيل middleware ───────────────────────────────────────────

  _enqueueComposer(event) {
    if (
      !this._enableComposer ||
      this._middlewares.length === 0 ||
      (event.type !== 'message' && event.type !== 'message_reply')
    ) return;

    const ctx = new MessengerContext(this, event);
    queueMicrotask(() => this._runComposer(ctx));
  }

  async _runComposer(ctx) {
    const dispatch = async (index) => {
      if (index >= this._middlewares.length) return;
      await this._middlewares[index](ctx, () => dispatch(index + 1));
    };

    try {
      await dispatch(0);
    } catch (err) {
      this._catchHandler ? this._catchHandler(err, ctx) : this.emit('error', err);
    }
  }

  // ── مصنع ثابت ─────────────────────────────────────────────────

  /**
   * أنشئ بوتاً وسجِّل الدخول بخطوة واحدة.
   * @param {object} credentials
   * @param {object} [opts]
   * @param {boolean} [opts.autoListen=true]
   * @param {boolean} [opts.enableComposer=true]
   * @param {string}  [opts.commandPrefix='/']
   * @param {boolean} [opts.stopOnSignals=false]
   * @param {number}  [opts.maxEventListeners=64]
   */
  static async connect(credentials, opts = {}) {
    const {
      autoListen        = true,
      enableComposer    = true,
      commandPrefix     = '/',
      stopOnSignals     = false,
      maxEventListeners = 64,
      ...loginOptions
    } = opts;

    const ctx = await login(credentials, loginOptions);
    const bot = new MessengerBot(ctx, { enableComposer, commandPrefix, stopOnSignals, maxEventListeners });

    if (autoListen) await bot.launch({ stopOnSignals });
    else if (stopOnSignals) bot.attachStopSignals();

    return bot;
  }
}

export function createMessengerBot(credentials, opts) {
  return MessengerBot.connect(credentials, opts);
}

export default { MessengerBot, createMessengerBot };

// ─── Plugin Descriptor ───────────────────────────────────────────
/** @type {import('./plugin-provider.js').FcaPlugin} */
export const $plugin = {
  name: 'fca-app-messenger-bot',
  meta: { category: 'app', path: 'lib/app/messenger-bot.js' },
  setup(_ctx) { /* provides: MessengerBot, createMessengerBot */ },
};
