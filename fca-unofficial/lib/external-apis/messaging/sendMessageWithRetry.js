export default function sendMessageWithRetryFactory(defaultFuncs, api, ctx) {
  return async function sendMessageWithRetry(msg, threadID, options = {}, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }

    // Retrying a send after an ambiguous network failure can duplicate a
    // message. Keep sends single-attempt unless the caller explicitly opts in.
    const maxRetries = Math.max(0, Math.min(Number(options.maxRetries ?? 0), 5));
    const baseDelay = Math.max(100, Math.min(Number(options.baseDelay ?? 1500), 10_000));
    const maxDelay = Math.max(baseDelay, Math.min(Number(options.maxDelay ?? 15_000), 60_000));
    const jitter = options.jitter !== false;
    const retryOn =
      typeof options.retryOn === 'function'
        ? options.retryOn
        : (err) =>
            err?.retryable === true &&
            !err?.ambiguous &&
            !String(err?.error ?? err?.message ?? '').includes('blocked');

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const withJitter = (ms) => {
      if (!jitter) return ms;
      const factor = 0.75 + Math.random() * 0.5; 
      return Math.min(maxDelay, Math.round(ms * factor));
    };

    const promise = (async () => {
      let lastErr;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          return await api.sendMessage(msg, threadID);
        } catch (err) {
          lastErr = err;
          const isLast = attempt === maxRetries;
          if (isLast || !retryOn(err)) throw err;
          const delay = withJitter(Math.min(baseDelay * 2 ** attempt, maxDelay));
          await sleep(delay);
        }
      }
      throw lastErr;
    })();

    if (typeof callback === 'function') {
      let called = false;
      const done = (err, result) => { if (called) return; called = true; callback(err, result); };
      promise.then((r) => done(null, r), (e) => done(e));
    }
    return promise;
  };
}

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('./plugin-provider.js').FcaPlugin} */
export const $plugin = {
  name: 'fca-external-apis-messaging-send-message-with-retry',
  meta: { category: 'external-api-messaging', path: 'lib/external-apis/messaging/sendMessageWithRetry.js' },
  setup(_ctx) {
    // provides: sendMessageWithRetryFactory
  },
};
