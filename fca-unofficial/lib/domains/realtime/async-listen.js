import { on } from 'node:events';
import { EventEmitter } from 'node:events';

export async function* listenAsync(api, signal) {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0); // lifecycle cleanup below prevents listener accumulation

  let stopListen;
  let ended = false;
  stopListen = api.listen((err, event) => {
    if (ended) return;
    if (err) { emitter.emit('eventError', err); return; }
    if (event) emitter.emit('event', event);
  });
  const onEventError = (err) => { if (!ended) emitter.emit('fatal', err); };
  emitter.on('eventError', onEventError);

  
  const onAbort = () => {
    emitter.emit('_done');
    if (typeof stopListen?.stopListening === 'function') {
      try {
        stopListen.stopListening();
      } catch {
        
      }
    }
  };

  if (signal) {
    if (signal.aborted) {
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    
    for await (const [event] of on(emitter, 'event', { signal })) {
      yield event;
    }
  } catch (err) {
    
    if (err?.name === 'AbortError' || signal?.aborted) return;
    throw err;
  } finally {
    ended = true;
    emitter.removeListener('eventError', onEventError);
    if (signal) signal.removeEventListener('abort', onAbort);
    onAbort();
  }
}

export async function* filterEvents(source, filter) {
  const predicate = typeof filter === 'string' ? (e) => e.type === filter : filter;

  for await (const event of source) {
    if (predicate(event)) yield event;
  }
}

export async function takeEvents(source, count) {
  const results = [];
  for await (const event of source) {
    results.push(event);
    if (results.length >= count) break;
  }
  return results;
}

export default { listenAsync, filterEvents, takeEvents };

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('./plugin-provider.js').FcaPlugin} */
export const $plugin = {
  name: 'fca-domains-realtime-async-listen',
  meta: { category: 'domain-realtime', path: 'lib/domains/realtime/async-listen.js' },
  setup(_ctx) {
    // provides: listenAsync, filterEvents, takeEvents
  },
};
