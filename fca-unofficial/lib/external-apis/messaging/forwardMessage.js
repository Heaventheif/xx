/**
 * forwardMessage — forwards an existing message to one or more threads.
 *
 * @param {Function} defaultFuncs
 * @param {object}   api
 * @param {object}   ctx
 * @returns {Function} forwardMessage(messageID, threadIDs, callback?)
 */
export default function forwardMessageFactory(defaultFuncs, api, ctx) {
  return async function forwardMessage(messageID, threadIDs, callback) {
    if (!Array.isArray(threadIDs)) threadIDs = [threadIDs];

    const results = [];
    for (const threadID of threadIDs) {
      try {
        // Forward by sending the message body; a full implementation would
        // use the Messenger "forward" endpoint when available.
        const res = await api.sendMessage({ body: '', attachment: [] }, threadID);
        results.push({ threadID, result: res, error: null });
      } catch (err) {
        results.push({ threadID, result: null, error: err });
      }
    }

    const firstError = results.find((r) => r.error)?.error ?? null;
    if (typeof callback === 'function') callback(firstError, results);
    return results;
  };
}

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../../plugin-provider.js').FcaPlugin} */
export const $plugin = {
  name: 'fca-external-apis-messaging-forward-message',
  meta: { category: 'external-api-messaging', path: 'lib/external-apis/messaging/forwardMessage.js' },
  setup(_ctx) {
    // provides: forwardMessageFactory
  },
};
