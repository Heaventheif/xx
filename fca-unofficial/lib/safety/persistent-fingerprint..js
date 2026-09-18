/**
 * persistent-fingerprint.js — deterministic per-account browser fingerprint.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 * ════════════════════════════════════════════════════════════════════════════
 *
 * FingerprintGenerator.generate() is stateless by design (unit-testable).
 * But in production, generating a fresh fingerprint on every process start
 * presents Facebook with a BRAND-NEW device signature on every restart —
 * the single highest-signal ban trigger we have.
 *
 * This module persists the fingerprint to disk, keyed by userID, so the bot
 * looks like the same device across reboots.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * STORAGE
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   Directory:  $FCA_FINGERPRINT_DIR  (default: <cwd>/.fca-fingerprints)
 *   Filename:   sha256("fca:" + userID)[:16].json
 *   Permissions: dir=0700, file=0600
 *   Write:      atomic (tmp + rename)
 *
 * ════════════════════════════════════════════════════════════════════════════
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { FingerprintGenerator } from './fingerprint-generator.js';
import logger from '../func/logger.js';

// ─── Config ──────────────────────────────────────────────────────────────────

function getStoreDir() {
  return process.env.FCA_FINGERPRINT_DIR
    || path.join(process.cwd(), '.fca-fingerprints');
}

function keyFor(userID) {
  return crypto.createHash('sha256')
    .update(`fca:${userID}`)
    .digest('hex')
    .slice(0, 16);
}

function filePathFor(userID) {
  return path.join(getStoreDir(), `${keyFor(userID)}.json`);
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * A fingerprint is only "valid" if it has the minimum fields we rely on.
 * Anything else is treated as corrupt and regenerated.
 */
function isValidFp(x) {
  return x
    && typeof x === 'object'
    && typeof x.userAgent === 'string' && x.userAgent.length > 20
    && typeof x.sessionId === 'string' && x.sessionId.length > 0
    && typeof x.deviceId  === 'string' && x.deviceId.length  > 0;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Load a persisted fingerprint for `userID`.
 * If none exists (or the existing one is corrupt), generate a fresh one and
 * persist it before returning.
 *
 * @param {string|number} userID
 * @param {object} [opts]  - passed to FingerprintGenerator when generating
 * @returns {object}       - the fingerprint object
 */
export function loadPersistentFingerprint(userID, opts = {}) {
  const fpPath = filePathFor(userID);

  try {
    if (fs.existsSync(fpPath)) {
      const raw = JSON.parse(fs.readFileSync(fpPath, 'utf8'));
      if (isValidFp(raw)) {
        return raw;
      }
      logger(
        `[Fingerprint] corrupted store at ${fpPath} — regenerating`,
        'warn'
      );
    }
  } catch (e) {
    logger(`[Fingerprint] read failed: ${e?.message}`, 'warn');
  }

  // Generate + persist
  const gen   = new FingerprintGenerator(opts);
  const fresh = gen.generate();

  fresh.accountUserID = String(userID);
  fresh.persistedAt   = Date.now();

  savePersistentFingerprint(userID, fresh);

  logger(
    `[Fingerprint] new persistent fingerprint for user ${String(userID).slice(0, 6)}…`,
    'info'
  );

  return fresh;
}

/**
 * Persist a fingerprint object. Atomic write — a crash mid-write cannot
 * corrupt the previous fingerprint.
 *
 * @param {string|number} userID
 * @param {object}        fp
 */
export function savePersistentFingerprint(userID, fp) {
  try {
    const dir = getStoreDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    const fpPath = filePathFor(userID);
    const tmp    = `${fpPath}.tmp.${process.pid}.${Date.now()}`;

    fs.writeFileSync(tmp, JSON.stringify(fp, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.renameSync(tmp, fpPath);
  } catch (e) {
    logger(`[Fingerprint] save failed: ${e?.message}`, 'warn');
  }
}

/**
 * Apply a persisted fingerprint to a live ctx object.
 * Must be called BEFORE any HTTP request leaves the process, otherwise the
 * first request will use a random profile.
 *
 * @param {object}        ctx     - the FCA context (mutated in place)
 * @param {string|number} userID
 * @param {object}        [opts]  - passed to FingerprintGenerator if generating
 * @returns {object}      - the fingerprint that was applied
 */
export function applyPersistentFingerprintToCtx(ctx, userID, opts) {
  if (!ctx || typeof ctx !== 'object') {
    throw new TypeError('applyPersistentFingerprintToCtx: ctx must be an object');
  }

  const fp = loadPersistentFingerprint(userID, opts);

  ctx._fingerprint = fp;

  // Replace the random stealth profile with one matching our persistent UA.
  // Note: `_stealthProfile` is read by `pickSessionProfile()` in
  // `stealth-profiles.js` and by `getHeaders()` in `utils/headers.js`.
  ctx._stealthProfile = {
    id:                     fp.profileId || 'persistent',
    userAgent:              fp.userAgent,
    secChUa:                fp.secChUa,
    secChUaMobile:          fp.secChUaMobile,
    secChUaPlatform:        fp.secChUaPlatform,
    secChUaArch:            fp.secChUaArch,
    secChUaBitness:         fp.secChUaBitness,
    secChUaWow64:           fp.secChUaWow64,
    secChUaFullVersionList: fp.secChUaFullVersionList,
    secChUaPlatformVersion: fp.secChUaPlatformVersion,
    acceptLanguage:         fp.locale ? `${fp.locale},en;q=0.9` : 'en-US,en;q=0.9',
    isFirefox:              false,
  };

  if (ctx.globalOptions && typeof ctx.globalOptions === 'object') {
    ctx.globalOptions.userAgent = fp.userAgent;
  }

  return fp;
}

export default {
  loadPersistentFingerprint,
  savePersistentFingerprint,
  applyPersistentFingerprintToCtx,
};