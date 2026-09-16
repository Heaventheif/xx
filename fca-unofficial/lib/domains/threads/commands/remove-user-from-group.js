// remove-user-from-group.js — Remove a participant from a group thread
// Prefers MQTT (task label 140), falls back to legacy HTTP endpoint.
import * as legacyPromise from '../../../compat/legacy-promise.js';
import * as capabilityResolver from '../../../session/capability-resolver.js';
import * as publish from '../../../transport/realtime/publish.js';
import * as httpFb from '../../../transport/http/facebook.js';

/**
 * Creates the removeUserFromGroup command.
 *
 * @param {{ defaultFuncs, ctx, generateOfflineThreadingID, logError? }} deps
 * @returns {(userID: string|number, threadID: string|number, callback?: Function) => Promise<{success}>}
 */
export function createRemoveUserFromGroupCommand(deps) {
  const { defaultFuncs, ctx, generateOfflineThreadingID, logError } = deps;

  return function removeUserFromGroup(userID, threadID, callback) {
    if (!callback && typeof threadID === 'function') {
      throw { error: 'please pass a threadID as a second argument.' };
    }

    const { callback: cb, promise } = legacyPromise.createLegacyPromise(callback, false);

    try {
      if (typeof threadID !== 'string' && typeof threadID !== 'number') {
        throw new Error(`threadID should be of type Number or String and not ${typeof threadID}.`);
      }
      if (typeof userID !== 'string' && typeof userID !== 'number') {
        throw new Error(`userID should be of type Number or String and not ${typeof userID}.`);
      }

      // ── MQTT path ───────────────────────────────────────────────
      if (ctx.mqttClient && ctx.mqttClient.connected) {
        capabilityResolver.assertMqttCapability(ctx);
        if (typeof ctx.wsReqNumber !== 'number') ctx.wsReqNumber = 0;

        publish
          .publishRealtimeMessage({
            client: ctx.mqttClient,
            topic: '/ls_req',
            payload: {
              app_id: '2220391788200892',
              payload: JSON.stringify({
                epoch_id: generateOfflineThreadingID(),
                tasks: [
                  {
                    failure_count: null,
                    label: '140',
                    payload: JSON.stringify({
                      thread_id: threadID,
                      contact_id: userID,
                      sync_group: 1,
                    }),
                    queue_name: 'remove_participant_v2',
                    task_id: Math.floor(Math.random() * 1001),
                  },
                ],
                version_id: '25002366262773827',
              }),
              request_id: ++ctx.wsReqNumber,
              type: 3,
            },
          })
          .then(() => cb(null, true))
          .catch((err) => {
            logError?.('removeUserFromGroup', err);
            cb(err);
          });

        return promise;
      }

      // ── HTTP fallback ────────────────────────────────────────────
      httpFb
        .postWithLoginCheck({
          defaultFuncs,
          ctx,
          url: 'https://www.facebook.com/chat/remove_participants',
          form: { uid: userID, tid: threadID },
        })
        .then((res) => {
          if (!res || res.error) {
            throw new Error(
              res?.error_msg || res?.errorSummary || String(res?.error) || 'Remove from group failed',
            );
          }
          cb(null, { success: true });
        })
        .catch((err) => {
          logError?.('removeUserFromGroup', err);
          cb(err instanceof Error ? err : new Error(String(err?.message ?? err)));
        });
    } catch (err) {
      logError?.('removeUserFromGroup', err);
      cb(err instanceof Error ? err : new Error(String(err?.message ?? err)));
    }

    return promise;
  };
}

// ─── Plugin Descriptor ───────────────────────────────────────────
/** @type {import('../../../plugin-provider.js').FcaPlugin} */
export const $plugin = {
  name: 'fca-domains-threads-commands-remove-user-from-group',
  meta: { category: 'domain-threads', path: 'lib/domains/threads/commands/remove-user-from-group.js' },
  setup(_ctx) {
    // provides: createRemoveUserFromGroupCommand
  },
};
