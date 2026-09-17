/**
 * client-factory.js — بناء طبقات MessengerClient بشكل منفصل.
 *
 * يُحوّل منطق الـ God Constructor إلى factory functions
 * واضحة ومختبَرة بشكل مستقل.
 */
import { createSessionGuard }            from '../safety/session-guard.js';
import { createCookieRefresher }         from '../safety/cookie-refresher.js';
import SingleSessionGuard                from '../safety/SingleSessionGuard.js';
import { StealthMode }                   from '../safety/StealthMode.js';
import FacebookSafety                    from '../safety/FacebookSafety.js';
import { AntiSuspension }                from '../safety/anti-suspension.js';
import { CircuitBreaker }                from '../safety/circuit-breaker.js';
import { PerRecipientLimiter }           from '../safety/per-recipient-limiter.js';
import { createWatchdog }                from '../safety/watchdog.js';
import { createSessionRotationManager }  from '../safety/session-rotation.js';
import { EventReplayBuffer }             from '../utils/event-replay-buffer.js';
import { ThreadSendQueue }               from '../utils/send-queue.js';
import { createHealthMetrics }           from '../performance/health-metrics.js';
import { createHealthServer }            from '../performance/health-server.js';

// ── Safety Layer ──────────────────────────────────────────────────────────

/**
 * يبني طبقة الأمان من options.
 * كل مكوّن يمكن تمريره كـ instance جاهز أو تعطيله بـ false.
 *
 * @param {object} opts
 * @returns {{
 *   sessionGuard:       object|null,
 *   cookieRefresher:    object|null,
 *   singleSession:      object|null,
 *   singleSessionPreAcquired: boolean,
 *   stealth:            object|null,
 *   fbSafety:           object|null,
 *   antiSuspension:     object|null,
 *   circuitBreaker:     object|null,
 *   recipientLimiter:   object|null,
 *   watchdog:           object|null,
 *   sessionRotation:    object|null,
 * }}
 */
export function buildSafetyLayer(opts, api) {
  const sessionGuard = opts.sessionGuard !== false
    ? createSessionGuard()
    : null;

  // Background warm-up requests are disabled by default. They add traffic without
  // improving an otherwise healthy MQTT session and can race with shutdown.
  const cookieRefresher = (opts.cookieRefresher === true && api._defaultFuncs)
    ? createCookieRefresher({
        appStatePath: opts.appStatePath,
        intervalMs:   opts.cookieRefreshIntervalMs,
      })
    : null;

  const singleSession = opts.singleSessionGuard !== false
    ? (opts.singleSessionGuardInstance || new SingleSessionGuard({
        lockPath:    opts.lockPath,
        staleAfterMs: opts.lockStaleAfterMs,
      }))
    : null;

  // Do not rotate user-agents, regions, or timing profiles by default. Stable
  // session identity is safer and less fragile than synthetic "anti-detection".
  const stealth = opts.stealthMode === true
    ? (opts.stealthModeInstance || new StealthMode(opts.stealthOptions))
    : null;

  const fbSafety = opts.facebookSafety === true
    ? (opts.facebookSafetyInstance || new FacebookSafety(opts.facebookSafetyOptions ?? {}))
    : null;

  const antiSuspension = opts.antiSuspension !== false
    ? (opts.antiSuspensionInstance || new AntiSuspension(opts.antiSuspensionOptions ?? {}))
    : null;

  const circuitBreaker = opts.circuitBreaker !== false
    ? (opts.circuitBreakerInstance || new CircuitBreaker({
        failureThreshold: opts.cbFailureThreshold ?? 5,
        recoveryTimeMs:   opts.cbRecoveryTimeMs   ?? 60_000,
        halfOpenLimit:    opts.cbHalfOpenLimit     ?? 2,
      }))
    : null;

  const recipientLimiter = opts.perRecipientLimiter !== false
    ? (opts.perRecipientLimiterInstance || new PerRecipientLimiter(opts.perRecipientLimiterOptions ?? {}))
    : null;

  const watchdog = opts.watchdog !== false
    ? (opts.watchdogInstance || createWatchdog({
        intervalMs:  opts.watchdogIntervalMs  ?? 60_000,
        staleAfterMs: opts.watchdogStaleAfterMs ?? 120_000,
      }))
    : null;

  // The old default constructed SessionRotationManager without api/context,
  // causing a recurring rejected rotation loop. Rotation is explicit and keeps
  // the same session identity when enabled.
  const sessionRotation = opts.sessionRotation === true
    ? (opts.sessionRotationInstance || createSessionRotationManager(
        api,
        api?._ctx ?? null,
        opts.sessionRotationOptions ?? {}
      ))
    : null;

  return {
    sessionGuard,
    cookieRefresher,
    singleSession,
    singleSessionPreAcquired: !!opts.singleSessionGuardPreAcquired,
    stealth,
    fbSafety,
    antiSuspension,
    circuitBreaker,
    recipientLimiter,
    watchdog,
    sessionRotation,
  };
}

// ── Infra Layer ───────────────────────────────────────────────────────────

/**
 * يبني طبقة البنية التحتية: health server، metrics، replay buffer.
 *
 * @param {object} opts
 * @returns {{ metrics: object, healthServer: object, replayBuffer: object|null }}
 */
export function buildInfraLayer(opts) {
  const metrics = createHealthMetrics();

  const healthServer = createHealthServer({
    port: opts.healthServerPort ?? parseInt(process.env.HEALTH_PORT ?? '10000', 10),
  });
  healthServer.attachMetrics(metrics);

  const replayBuffer = opts.eventReplay !== false
    ? new EventReplayBuffer({ maxSize: opts.eventReplaySize ?? 50 })
    : null;

  return { metrics, healthServer, replayBuffer };
}

// ── Send Queue ────────────────────────────────────────────────────────────

/**
 * يبني طابور الإرسال مع ربط طبقة الأمان.
 *
 * @param {object} api
 * @param {object} safety  - ناتج buildSafetyLayer
 * @param {object} opts
 * @returns {ThreadSendQueue}
 */
export function buildSendQueue(api, safety, opts) {
  const { circuitBreaker, recipientLimiter, stealth, antiSuspension, fbSafety } = safety;

  async function sendFn(msg, threadID, replyToID) {
    if (circuitBreaker)   await circuitBreaker.call(() => Promise.resolve());
    if (antiSuspension)   await antiSuspension.gate();
    if (recipientLimiter) await recipientLimiter.acquire(threadID);

    try {
      if (stealth) await stealth.waitIfNeeded();

      return await new Promise((resolve, reject) => {
        const done = (err, result) => {
          if (err) {
            circuitBreaker?.recordFailure();
            reject(err);
            return;
          }
          stealth?.recordRequest();
          circuitBreaker?.recordSuccess();
          resolve(result);
        };

        if (replyToID) api.sendMessage(msg, threadID, replyToID, done);
        else           api.sendMessage(msg, threadID, done);
      });
    } catch (err) {
      // A checkpoint/security restriction must stop further automated sends.
      const safety = fbSafety?.checkErrorSafety?.(err);
      if (safety && !safety.safe) antiSuspension?.stop?.();
      throw err;
    } finally {
      // The previous implementation never released this permit, so every
      // recipient eventually deadlocked after maxConcurrent sends.
      recipientLimiter?.release(threadID);
    }
  }

  return new ThreadSendQueue(sendFn, {
    maxQueueSize:  opts.maxQueueSize  ?? 50,
    interMsgDelay: opts.interMsgDelay ?? 300,
  });
}
