/**
 * messenger-context.js — سياق الرسالة الواردة داخل middleware البوت.
 *
 * يُمرَّر إلى كل middleware كـ `ctx`، ويوفر:
 *  - خصائص قراءة سريعة للحدث (threadID, text, …)
 *  - طرق إرسال مُحسَّنة (reply, replyDM)
 */

export class MessengerContext {
  /**
   * @param {import('./messenger-bot.js').MessengerBot} bot
   * @param {object} event - حدث MQTT الخام
   */
  constructor(bot, event) {
    this.bot   = bot;
    this.event = event;
  }

  // ── خصائص الحدث ───────────────────────────────────────────────

  get threadID()  { return this.event.threadID; }
  get senderID()  { return this.event.senderID; }
  get messageID() { return this.event.messageID; }
  get text()      { return (this.event.body ?? '').trim(); }
  get body()      { return this.event.body; }
  get message()   { return this.event; }
  get api()       { return this.bot.api; }

  // ── نوع المحادثة ──────────────────────────────────────────────

  get isGroup() { return !!this.event.isGroup; }
  get isDM()    { return !this.event.isGroup; }

  // ── إرسال ─────────────────────────────────────────────────────

  reply(message, replyToID) {
    const threadID = this.event.threadID;
    if (threadID == null) throw new Error('MessengerContext.reply: threadID is missing');
    return this._send(String(threadID), message, replyToID);
  }

  async replyAsync(message, replyToID) {
    const result = this.reply(message, replyToID);
    return result && typeof result.then === 'function' ? result : Promise.resolve(result);
  }

  replyDM(message, replyToID) {
    const dmThreadID = this.event.senderID;
    if (dmThreadID == null) throw new Error('MessengerContext.replyDM: senderID is missing');
    return this._send(String(dmThreadID), message, replyToID);
  }

  async replyDMAsync(message, replyToID) {
    const result = this.replyDM(message, replyToID);
    return result && typeof result.then === 'function' ? result : Promise.resolve(result);
  }

  // ── داخلي ─────────────────────────────────────────────────────

  _send(targetThreadID, message, replyToID) {
    const { api } = this.bot;
    const promise = api.sendMessage.call(api, message, targetThreadID, replyToID);
    promise?.catch?.(() => {});
    return promise;
  }
}

export default { MessengerContext };

// ─── Plugin Descriptor ───────────────────────────────────────────
/** @type {import('./plugin-provider.js').FcaPlugin} */
export const $plugin = {
  name: 'fca-app-messenger-context',
  meta: { category: 'app', path: 'lib/app/messenger-context.js' },
  setup(_ctx) { /* provides: MessengerContext */ },
};
