// add-users-to-group.js — Add one or more users to a group thread via MQTT LS task
import * as legacyPromise from '../../../compat/legacy-promise.js';
import * as capabilityResolver from '../../../session/capability-resolver.js';
import * as lsRequests from '../../../transport/realtime/ls-requests.js';

/**
 * Creates the addUsersToGroup command.
 * Requires an active MQTT connection (call listenMqtt first).
 *
 * @param {{ ctx, generateOfflineThreadingID, logError? }} deps
 * @returns {(userID: string | string[], threadID: string | number, callback?: Function) => Promise<{success, response}>}
 */
export function createAddUsersToGroupCommand(deps) {
  const { ctx, generateOfflineThreadingID, logError } = deps;

  return function addUsersToGroup(userID, threadID, callback) {
    const { callback: cb, promise } = legacyPromise.createLegacyPromise(callback);

    try {
      capabilityResolver.assertMqttCapability(ctx);

      if (typeof threadID !== 'string' && typeof threadID !== 'number') {
        throw new Error('ThreadID should be of type Number or String.');
      }

      const ids = Array.isArray(userID) ? userID : [userID];
      if (!ids.length) throw new Error('userID is required');

      if (typeof ctx.wsReqNumber !== 'number') ctx.wsReqNumber = 0;
      if (typeof ctx.wsTaskNumber !== 'number') ctx.wsTaskNumber = 0;

      const requestId = ++ctx.wsReqNumber;
      const taskId = ++ctx.wsTaskNumber;

      lsRequests
        .publishLsRequestWithAck({
          client: ctx.mqttClient,
          requestId,
          content: {
            app_id: '772021112871879',
            payload: JSON.stringify({
              epoch_id: generateOfflineThreadingID(),
              tasks: [
                {
                  failure_count: null,
                  label: '23',
                  payload: JSON.stringify({
                    thread_key: threadID,
                    contact_ids: ids,
                    sync_group: 1,
                  }),
                  queue_name: String(threadID),
                  task_id: taskId,
                },
              ],
              version_id: '24502707779384158',
            }),
            request_id: requestId,
            type: 3,
          },
          extract: (res) => ({ success: true, response: res.payload }),
        })
        .then((res) => cb(null, res))
        .catch((err) => {
          logError?.('addUsersToGroup', err);
          cb(err);
        });
    } catch (err) {
      logError?.('addUsersToGroup', err);
      cb(err);
    }

    return promise;
  };
}

// ─── Plugin Descriptor ───────────────────────────────────────────
/** @type {import('../../../plugin-provider.js').FcaPlugin} */
export const $plugin = {
  name: 'fca-domains-threads-commands-add-users-to-group',
  meta: { category: 'domain-threads', path: 'lib/domains/threads/commands/add-users-to-group.js' },
  setup(_ctx) {
    // provides: createAddUsersToGroupCommand
  },
};
