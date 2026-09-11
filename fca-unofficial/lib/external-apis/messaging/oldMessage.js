/**
 * oldMessage — retrieves a message by its ID from thread history.
 *
 * @param {Function} defaultFuncs
 * @param {object}   api
 * @param {object}   ctx
 * @returns {Function} oldMessage(messageID, threadID, callback?)
 */
export default function oldMessageFactory(defaultFuncs, api, ctx) {
  return async function oldMessage(messageID, threadID, callback) {
    try {
      // Delegate to getMessage if available, otherwise return a stub.
      let result;
      if (typeof api.getMessage === 'function') {
        result = await api.getMessage(messageID, threadID);
      } else {
        result = { messageID, threadID, body: null, attachments: [], timestamp: null };
      }
      if (typeof callback === 'function') callback(null, result);
      return result;
    } catch (err) {
      if (typeof callback === 'function') callback(err);
      throw err;
    }
  };
}

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../../plugin-provider.js').FcaPlugin} */
export const $plugin = {
  name: 'fca-external-apis-messaging-old-message',
  meta: { category: 'external-api-messaging', path: 'lib/external-apis/messaging/oldMessage.js' },
  setup(_ctx) {
    // provides: oldMessageFactory
  },
};
