/**
 * sendBroadcast — sends a message to multiple thread IDs sequentially.
 *
 * @param {Function} defaultFuncs
 * @param {object}   api
 * @param {object}   ctx
 * @returns {Function} sendBroadcast(msg, threadIDs, options?, callback?)
 */
export default function sendBroadcastFactory(defaultFuncs, api, ctx) {
  return async function sendBroadcast(msg, threadIDs, options = {}, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    if (!Array.isArray(threadIDs)) threadIDs = [threadIDs];

    const delay = options.delay ?? 500;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const results = [];
    const errors  = [];

    for (let i = 0; i < threadIDs.length; i++) {
      try {
        const res = await api.sendMessage(msg, threadIDs[i]);
        results.push({ threadID: threadIDs[i], result: res, error: null });
      } catch (err) {
        errors.push({ threadID: threadIDs[i], error: err });
        results.push({ threadID: threadIDs[i], result: null, error: err });
      }
      if (i < threadIDs.length - 1 && delay > 0) await sleep(delay);
    }

    const summary = { results, errors: errors.length ? errors : null };
    if (typeof callback === 'function') callback(errors.length ? errors : null, summary);
    return summary;
  };
}

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../../plugin-provider.js').FcaPlugin} */
export const $plugin = {
  name: 'fca-external-apis-messaging-send-broadcast',
  meta: { category: 'external-api-messaging', path: 'lib/external-apis/messaging/sendBroadcast.js' },
  setup(_ctx) {
    // provides: sendBroadcastFactory
  },
};
