/**
 * session-manager.js — explicit, encrypted, atomic AppState persistence.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * DESIGN GOALS
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   1. ONE clear API — `save(api)` / `restore()` / `clear()` / `exists()`.
 *      No hidden background writes; no surprise cookie mutations.
 *
 *   2. ATOMIC writes — tmp file + fsync + rename. A crash mid-write cannot
 *      leave a half-written session on disk.
 *
 *   3. ENCRYPTED at rest — AES-256-GCM, per-value random salt, scrypt N=2^15
 *      (OWASP 2024 interactive floor). Plaintext is only allowed when the
 *      caller explicitly opts in for a local development migration.
 *
 *   4. PLUGGABLE storage — File / Memory backends ship here. Users can add
 *      Mongo/S3 backends by implementing the 3-method interface.
 *
 *   5. SINGLE-FLIGHT saves — concurrent `save()` calls share one promise,
 *      so parallel commands cannot corrupt the store.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * USAGE
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   import { SessionManager, FileStorage } from
 *     'fca-unofficial/lib/session/session-manager.js';
 *
 *   const mgr = new SessionManager({
 *     userID: '61551132213582',
 *     storage: new FileStorage('./.session1.json', {
 *       secret: process.env.FCA_SESSION_KEY,
 *     }),
 *   });
 *
 *   const payload = await mgr.restore();       // → { appState, meta, ... } | null
 *   // ... login using payload.appState ...
 *   await mgr.save(api, { label: 'post-login' });
 *
 * ════════════════════════════════════════════════════════════════════════════
 *
 * @typedef {object} SessionPayload
 * @property {number}  version
 * @property {string}  userID
 * @property {Array}   appState
 * @property {object}  meta        - { savedAt, label, trigger, ... }
 * @property {object|null} fingerprint
 *
 * @typedef {object} StorageBackend
 * @property {() => Promise<SessionPayload|null>} read
 * @property {(payload: SessionPayload) => Promise<void>} write
 * @property {() => Promise<void>} clear
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import logger from '../func/logger.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Bump this only when the payload shape changes (invalidates old stores). */
const VERSION = 1;

/** Magic prefix distinguishes our ciphertext from plaintext JSON. */
const MAGIC = 'FCASESS1:';

/**
 * scrypt parameters.
 *   N = 2^15 → OWASP-recommended minimum for interactive KDF (2024).
 *   Higher N blocks the event loop; 2^17 was ~300ms/derivation on low-end HW.
 */
const SCRYPT = Object.freeze({
  N: 1 << 15,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
});

const b64   = (b) => Buffer.from(b).toString('base64');
const unb64 = (s) => Buffer.from(s, 'base64');

// ─── Crypto helpers ──────────────────────────────────────────────────────────

/**
 * Derive a 32-byte AES key from a secret and salt using scrypt.
 * @param {string} secret
 * @param {Buffer} salt
 * @returns {Buffer}
 */
function deriveKey(secret, salt) {
  return crypto.scryptSync(secret, salt, 32, SCRYPT);
}

/**
 * Encrypt a JS object to our on-disk format.
 * If `secret` is null/undefined, we serialize as plaintext JSON — the caller
 * is responsible for warning the user (see FileStorage constructor).
 *
 * @param {object} obj
 * @param {string|null} secret
 * @returns {string}
 */
function encryptPayload(obj, secret) {
  const serialized = JSON.stringify(obj);
  if (!secret) return serialized;

  const salt = crypto.randomBytes(16);
  const iv   = crypto.randomBytes(12);
  const key  = deriveKey(secret, salt);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  const ct     = Buffer.concat([cipher.update(serialized, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();

  return MAGIC + [b64(salt), b64(iv), b64(tag), b64(ct)].join(':');
}

/**
 * Decrypt our on-disk format back to a JS object.
 * Detects both the encrypted envelope and legacy plaintext.
 *
 * @param {string} text
 * @param {string|null} secret
 * @param {string} filePath  - for error messages only
 * @returns {object}
 * @throws {Error} with code STORE_DECRYPT_FAILED
 */
function decryptPayload(text, secret, filePath) {
  // Legacy / plaintext path
  if (!text.startsWith(MAGIC)) {
    return JSON.parse(text);
  }

  if (!secret) {
    const e = new Error(
      `session store at ${filePath} is encrypted but FCA_SESSION_KEY is not set`
    );
    e.code = 'STORE_DECRYPT_FAILED';
    throw e;
  }

  try {
    const parts = text.slice(MAGIC.length).split(':');
    if (parts.length !== 4) {
      throw new Error(`malformed envelope (expected 4 parts, got ${parts.length})`);
    }
    const [saltB64, ivB64, tagB64, ctB64] = parts;
    const salt = unb64(saltB64);
    const iv   = unb64(ivB64);
    const tag  = unb64(tagB64);
    const ct   = unb64(ctB64);

    const key = deriveKey(secret, salt);
    const dec = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    dec.setAuthTag(tag);

    const plaintext = Buffer.concat([dec.update(ct), dec.final()]).toString('utf8');
    return JSON.parse(plaintext);
  } catch (cause) {
    const e = new Error(`decrypt failed for ${filePath}: ${cause.message}`);
    e.code = 'STORE_DECRYPT_FAILED';
    e.cause = cause;
    throw e;
  }
}

// ─── Storage backends ────────────────────────────────────────────────────────

/**
 * File-backed storage. Writes atomically (tmp + fsync + rename) and refuses
 * paths outside the current working directory to prevent accidental exfil.
 *
 * File permissions: 0600 for files, 0700 for the containing directory.
 */
export class FileStorage {
  /**
   * @param {string} filePath
   * @param {{ secret?: string|null }} [opts]
   */
  constructor(filePath, { secret, allowPlaintext = false } = {}) {
    const resolved = path.resolve(filePath);
    const cwd      = path.resolve(process.cwd());

    if (!resolved.startsWith(cwd + path.sep) && resolved !== cwd) {
      throw new Error(`FileStorage: path outside cwd rejected: ${resolved}`);
    }

    this.filePath = resolved;
    this.secret   = secret ?? process.env.FCA_SESSION_KEY ?? null;
    this.allowPlaintext = allowPlaintext === true ||
      process.env.FCA_ALLOW_PLAINTEXT_APPSTATE_BACKUP === 'true';

    if (!this.secret && !this.allowPlaintext) {
      logger(
        `[SessionManager] ⚠️ no FCA_SESSION_KEY — ${path.basename(resolved)} ` +
        'will not be written until encryption is configured',
        'warn'
      );
    }
  }

  /** @returns {Promise<SessionPayload|null>} */
  async read() {
    try {
      if (!fs.existsSync(this.filePath)) return null;
      const text = fs.readFileSync(this.filePath, 'utf8');
      if (!text.trim()) return null;
      if (!this.secret && !this.allowPlaintext && !text.startsWith(MAGIC)) {
        throw new Error(
          `plaintext session store at ${this.filePath} rejected; ` +
          'set FCA_SESSION_KEY or explicitly allow plaintext for migration'
        );
      }
      return decryptPayload(text, this.secret, this.filePath);
    } catch (e) {
      logger(
        `[SessionManager] read(${path.basename(this.filePath)}) failed: ${e.message}`,
        'warn'
      );
      return null;
    }
  }

  /** @param {SessionPayload} payload */
  async write(payload) {
    if (!this.secret && !this.allowPlaintext) {
      const error = new Error(
        'FCA_SESSION_KEY is required to persist AppState securely'
      );
      error.code = 'SESSION_KEY_REQUIRED';
      throw error;
    }
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    // Unique tmp name avoids two processes clobbering each other during a
    // rolling restart (the rename is still atomic, but the tmp must exist).
    const tmp = `${this.filePath}.tmp.${process.pid}.${Date.now()}`;
    const body = encryptPayload(payload, this.secret);

    const fd = fs.openSync(tmp, 'w', 0o600);
    try {
      fs.writeSync(fd, body, 0, 'utf8');
      fs.fsyncSync(fd);           // durability: survive a hard power loss
    } finally {
      fs.closeSync(fd);
    }

    fs.renameSync(tmp, this.filePath);  // atomic POSIX rename
  }

  async clear() {
    try { fs.unlinkSync(this.filePath); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}

/**
 * In-memory storage — useful for tests and ephemeral sessions.
 * No persistence; nothing survives a process restart.
 */
export class MemoryStorage {
  constructor() { this._v = null; }
  async read()   { return this._v; }
  async write(p) { this._v = p; }
  async clear()  { this._v = null; }
}

// ─── SessionManager ──────────────────────────────────────────────────────────

export class SessionManager extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string|number} opts.userID
   * @param {StorageBackend} opts.storage
   */
  constructor({ userID, storage }) {
    super();
    if (!userID)  throw new Error('SessionManager: userID is required');
    if (!storage) throw new Error('SessionManager: storage is required');

    this.userID   = String(userID);
    this.storage  = storage;
    this._savePromise = null;   // single-flight guard
  }

  /**
   * Persist the current AppState of `api`.
   * Single-flight: concurrent calls share one promise so we never race on
   * the tmp file, and so multiple commands cannot interleave writes.
   *
   * @param {object} api              - must expose getAppState()
   * @param {object} [meta={}]        - arbitrary metadata (label, trigger, ...)
   * @returns {Promise<SessionPayload>}
   */
  async save(api, meta = {}) {
    if (this._savePromise) return this._savePromise;
    this._savePromise = this._saveImpl(api, meta)
      .finally(() => { this._savePromise = null; });
    return this._savePromise;
  }

  async _saveImpl(api, meta) {
    if (!api || typeof api.getAppState !== 'function') {
      throw new Error('SessionManager.save: api.getAppState is not available');
    }

    const appState = api.getAppState();
    if (!Array.isArray(appState) || appState.length === 0) {
      throw new Error('SessionManager.save: appState is empty');
    }

    // Refuse to persist obviously-contaminated state (mixed accounts).
    const cUser = appState.find((c) => (c.key || c.name) === 'c_user');
    if (cUser && String(cUser.value) !== this.userID) {
      logger(
        `[SessionManager] refusing to save: c_user=${cUser.value} != userID=${this.userID}`,
        'error'
      );
      throw new Error('SessionManager.save: appState belongs to a different user');
    }

    const payload = {
      version: VERSION,
      userID:  this.userID,
      appState,
      meta: { ...meta, savedAt: new Date().toISOString() },
      fingerprint: api._ctx?._fingerprint ?? null,
    };

    await this.storage.write(payload);
    this.emit('saved', {
      userID: this.userID,
      cookieCount: appState.length,
      meta: payload.meta,
    });
    return payload;
  }

  /**
   * Read and validate a stored session.
   * Returns `null` if:
   *   - no file exists
   *   - the file belongs to a different userID
   *   - the file is empty or corrupted
   *
   * @returns {Promise<SessionPayload|null>}
   */
  async restore() {
    const payload = await this.storage.read();
    if (!payload) return null;

    if (payload.userID && String(payload.userID) !== this.userID) {
      logger(
        `[SessionManager] userID mismatch: stored=${payload.userID} requested=${this.userID} — refusing`,
        'warn'
      );
      return null;
    }

    if (!Array.isArray(payload.appState) || payload.appState.length === 0) {
      logger('[SessionManager] stored payload has empty appState', 'warn');
      return null;
    }

    this.emit('restored', { userID: this.userID, meta: payload.meta });
    return payload;
  }

  /** Delete the stored session. Safe to call when nothing exists. */
  async clear() {
    await this.storage.clear();
    this.emit('cleared', { userID: this.userID });
  }

  /** @returns {Promise<boolean>} */
  async exists() {
    return (await this.storage.read()) != null;
  }
}

export default { SessionManager, FileStorage, MemoryStorage };