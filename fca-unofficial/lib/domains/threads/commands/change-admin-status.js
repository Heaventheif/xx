// change-admin-status.js — Grant or revoke admin privileges in a group thread
// Prefers MQTT (task label 25), falls back to HTTP graphqlbatch endpoint.
import * as capabilityResolver from '../../../session/capability-resolver.js';
import * as publish from '../../../transport/realtime/publish.js';
import * as httpFb from '../../../transport/http/facebook.js';

/**
 * Creates the changeAdminStatus command.
 *
 * @param {{ defaultFuncs, ctx, generateOfflineThreadingID, logError? }} deps
 * @returns {(threadID: string, adminID: string | string[], adminStatus: boolean) => Promise<{success}>}
 */
export function createChangeAdminStatusCommand(deps) {
  const { defaultFuncs, ctx, generateOfflineThreadingID, logError } = deps;

  return function changeAdminStatus(threadID, adminID, adminStatus) {
    if (typeof threadID !== 'string') {
      throw { error: 'changeAdminStatus: threadID must be a string' };
    }
    if (typeof adminID !== 'string' && !Array.isArray(adminID)) {
      throw { error: 'changeAdminStatus: adminID must be a string or an array' };
    }
    if (typeof adminStatus !== 'boolean') {
      throw { error: 'changeAdminStatus: adminStatus must be true or false' };
    }

    const isAdmin = adminStatus ? 1 : 0;
    const adminIDs = Array.isArray(adminID) ? adminID : [adminID];

    if (typeof ctx.wsReqNumber !== 'number') ctx.wsReqNumber = 0;
    if (typeof ctx.wsTaskNumber !== 'number') ctx.wsTaskNumber = 0;

    const tasks = adminIDs.map((id, i) => ({
      failure_count: null,
      label: '25',
      payload: JSON.stringify({ thread_key: threadID, contact_id: id, is_admin: isAdmin }),
      queue_name: 'admin_status',
      task_id: ++ctx.wsTaskNumber,
    }));

    // ── MQTT path ─────────────────────────────────────────────────
    if (ctx.mqttClient && ctx.mqttClient.connected) {
      try {
        capabilityResolver.assertMqttCapability(ctx);
      } catch (err) {
        logError?.('changeAdminStatus', err);
        return Promise.reject(err);
      }

      return publish
        .publishRealtimeMessage({
          client: ctx.mqttClient,
          topic: '/ls_req',
          payload: {
            app_id: String(ctx.appID || ctx.mqttAppID || '2220391788200892'),
            payload: JSON.stringify({
              epoch_id: generateOfflineThreadingID(),
              tasks,
              version_id: '8798795233522156',
            }),
            request_id: ++ctx.wsReqNumber,
            type: 3,
          },
        })
        .then(() => ({ success: true }))
        .catch((err) => {
          logError?.('changeAdminStatus', err);
          throw err;
        });
    }

    // ── HTTP fallback ─────────────────────────────────────────────
    logError?.('changeAdminStatus', new Error('MQTT not available, using HTTP fallback'));

    return httpFb
      .postWithLoginCheck({
        defaultFuncs,
        ctx,
        url: 'https://www.facebook.com/api/graphqlbatch/',
        form: {
          fb_dtsg: ctx.fb_dtsg,
          request_id: ++ctx.wsReqNumber,
          type: 3,
          payload: JSON.stringify({
            version_id: '8798795233522156',
            tasks,
            epoch_id: generateOfflineThreadingID(),
            data_trace_id: null,
          }),
          app_id: String(ctx.appID || ctx.mqttAppID || '772021112871879'),
        },
      })
      .then(() => ({ success: true }))
      .catch((err) => {
        logError?.('changeAdminStatus (HTTP)', err);
        throw err instanceof Error ? err : new Error(String(err?.message ?? err));
      });
  };
}

// ─── Plugin Descriptor ───────────────────────────────────────────
/** @type {import('../../../plugin-provider.js').FcaPlugin} */
export const $plugin = {
  name: 'fca-domains-threads-commands-change-admin-status',
  meta: { category: 'domain-threads', path: 'lib/domains/threads/commands/change-admin-status.js' },
  setup(_ctx) {
    // provides: createChangeAdminStatusCommand
  },
};
