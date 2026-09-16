import { emitMqttPublish } from '../../observability/channels.js';

// ── Central per-client message router ───────────────────────────────────────
// A single 'message' listener is attached to each MQTT client and routes
// /ls_resp frames by request_id to the matching pending promise.
// This prevents N concurrent publishLsRequestWithAck calls from stacking
// N individual listeners on the same EventEmitter (Node warns at 10+).

function ensureLsRouter(client) {
  if (client._lsRouter) return client._lsRouter;

  // Map<request_id, { responseTopic, settle(parsed), reject(err) }>
  const pending = new Map();

  function onMessage(topic, rawMsg) {
    let parsed;
    try {
      parsed = JSON.parse(rawMsg.toString());
      if (typeof parsed.payload === 'string') parsed.payload = JSON.parse(parsed.payload);
    } catch { return; }

    const entry = pending.get(parsed.request_id);
    if (!entry || entry.responseTopic !== topic) return;

    // Remove before settling so a re-used request_id doesn't match stale entry
    pending.delete(parsed.request_id);
    entry.settle(parsed);
  }

  client.on('message', onMessage);

  // When the client closes, reject all pending requests
  client.once('close', () => {
    if (!client._lsRouter) return;
    client._lsRouter = null;
    try { client.removeListener('message', onMessage); } catch {}
    const err = Object.assign(new Error('MQTT client closed'), { code: 'MQTT_CLOSED' });
    for (const entry of pending.values()) { try { entry.reject(err); } catch {} }
    pending.clear();
  });

  const router = { pending, onMessage };
  client._lsRouter = router;
  return router;
}

// ── publishLsRequestWithAck ──────────────────────────────────────────────────

export async function publishLsRequestWithAck(params) {
  const {
    client,
    content,
    requestId,
    topic = '/ls_req',
    responseTopic = '/ls_resp',
    timeoutMs = 15000,
    extract,
    abortSignal = null,
  } = params;

  if (
    !client ||
    typeof client.on !== 'function' ||
    typeof client.publish !== 'function' ||
    typeof client.removeListener !== 'function'
  ) {
    throw new Error('MQTT client is not initialized');
  }

  let timeoutSignal;
  try { timeoutSignal = AbortSignal.timeout(timeoutMs); } catch { timeoutSignal = null; }

  const combinedSignal =
    abortSignal && timeoutSignal && typeof AbortSignal.any === 'function'
      ? AbortSignal.any([timeoutSignal, abortSignal])
      : timeoutSignal || abortSignal;

  emitMqttPublish({ topic, requestId, size: JSON.stringify(content).length });

  return new Promise((resolve, reject) => {
    let settled = false;

    const router = ensureLsRouter(client);

    const cleanup = () => {
      router.pending.delete(requestId);
      if (combinedSignal) combinedSignal.removeEventListener('abort', onAbort);
    };

    const settle = (fn) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const onAbort = () => {
      const isTimeout = timeoutSignal?.aborted;
      settle(() =>
        reject(
          isTimeout
            ? Object.assign(
                new Error(`MQTT ACK timeout after ${timeoutMs}ms (req: ${requestId})`),
                { code: 'MQTT_TIMEOUT', requestId }
              )
            : Object.assign(new Error('MQTT request aborted'), {
                code: 'MQTT_ABORTED',
                cause: combinedSignal?.reason,
              })
        )
      );
    };

    if (combinedSignal) {
      if (combinedSignal.aborted) { onAbort(); return; }
      combinedSignal.addEventListener('abort', onAbort, { once: true });
    }

    // Register in the central router instead of adding a per-request listener
    router.pending.set(requestId, {
      responseTopic,
      settle(parsed) {
        settle(() => {
          try { resolve(extract(parsed)); } catch (err) { reject(err); }
        });
      },
      reject(err) { settle(() => reject(err)); },
    });

    client.publish(topic, JSON.stringify(content), { qos: 1, retain: false }, (err) => {
      if (err)
        settle(() =>
          reject(
            Object.assign(new Error('MQTT publish failed'), {
              code: 'MQTT_PUBLISH_ERROR',
              cause: err,
            })
          )
        );
    });
  });
}

export default { publishLsRequestWithAck };

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('./plugin-provider.js').FcaPlugin} */
export const $plugin = {
  name: 'fca-transport-realtime-ls-requests',
  meta: { category: 'transport', path: 'lib/transport/realtime/ls-requests.js' },
  setup(_ctx) {
    // provides: publishLsRequestWithAck
  },
};
