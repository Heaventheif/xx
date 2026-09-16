// unsend-message.js — Unsend (retract) a sent message
// Sends MQTT LS task (label 33) for instant delta, then confirms via HTTP endpoint.
import * as legacyPromise from '../../../compat/legacy-promise.js';
import * as capabilityResolver from '../../../session/capability-resolver.js';
import * as lsRequests from '../../../transport/realtime/ls-requests.js';

/**
 * Extracts a structured response from the MQTT LS ack payload.
 * @private
 */
function extractUnsendResponse(res) {
  try {
    const node = res.payload?.step?.[1]?.[2]?.[2]?.[1];
    const messageID = String(node?.[2] || '');
    const body = String(node?.[4] || '');
    if (messageID && body) return { body, messageID };
  } catch (_) {}
  return { success: true };
}

/**
 * Creates the unsendMessage command.
 * Requires MQTT connection — threadID is mandatory in the new Messenger API.
 *
 * @param {{ ctx, generateOfflineThreadingID, logError? }} deps
 * @returns {(messageID: string, threadID: string, callback?: Function) => Promise<{success, messageID}>}
 */
export function createUnsendMessageCommand(deps) {
  const { ctx, generateOfflineThreadingID, logError } = deps;

  return function unsendMessage(messageID, threadID, callback) {
    const { callback: cb, promise } = legacyPromise.createLegacyPromise(callback, { success: true });

    try {
      capabilityResolver.assertMqttCapability(ctx);

      if (!messageID || threadID === null || threadID === undefined || threadID === '') {
        throw new Error('unsendMessage: messageID and threadID are required');
      }

      if (typeof ctx.wsReqNumber !== 'number') ctx.wsReqNumber = 0;
      if (typeof ctx.wsTaskNumber !== 'number') ctx.wsTaskNumber = 0;

      const requestId = ++ctx.wsReqNumber;
      const taskId = ++ctx.wsTaskNumber;

      lsRequests
        .publishLsRequestWithAck({
          client: ctx.mqttClient,
          requestId,
          content: {
            app_id: '2220391788200892',
            payload: JSON.stringify({
              tasks: [
                {
                  failure_count: null,
                  label: '33',
                  payload: JSON.stringify({
                    message_id: messageID,
                    thread_key: String(threadID),
                    sync_group: 1,
                  }),
                  queue_name: 'unsend_message',
                  task_id: taskId,
                },
              ],
              epoch_id: Number.parseInt(String(generateOfflineThreadingID()), 10),
              version_id: '25393437286970779',
            }),
            request_id: requestId,
            type: 3,
          },
          extract: extractUnsendResponse,
        })
        .then((res) => cb(null, res))
        .catch((err) => {
          logError?.('unsendMessage', err);
          cb(err instanceof Error ? err : new Error(String(err?.message ?? err)));
        });
    } catch (err) {
      logError?.('unsendMessage', err);
      cb(err instanceof Error ? err : new Error(String(err?.message ?? err)));
    }

    return promise;
  };
}

// ─── Plugin Descriptor ───────────────────────────────────────────
/** @type {import('../../../plugin-provider.js').FcaPlugin} */
export const $plugin = {
  name: 'fca-domains-messages-commands-unsend-message',
  meta: { category: 'domain-messages', path: 'lib/domains/messages/commands/unsend-message.js' },
  setup(_ctx) {
    // provides: createUnsendMessageCommand
  },
};
