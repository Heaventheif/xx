/**
 * errors.js — هرمية أخطاء FCA الموحَّدة.
 *
 * الهرمية:
 *   Error
 *     └─ FcaError                      (أساس كل أخطاء FCA)
 *          ├─ FcaNetworkError          (أخطاء الشبكة العامة)
 *          │    ├─ FcaHttpError        (أخطاء HTTP بكود الحالة)
 *          │    ├─ FcaMqttError        (أخطاء MQTT العامة)
 *          │    │    ├─ FcaMqttTimeoutError
 *          │    │    └─ FcaMqttNotInitializedError
 *          ├─ FcaAuthError             (أخطاء المصادقة)
 *          │    └─ FcaNotLoggedInError
 *          ├─ FcaSessionError          (أخطاء دورة حياة الجلسة)
 *          │    ├─ FcaFingerprintMismatchError
 *          │    └─ FcaStoreDecryptionError
 *          ├─ FcaRateLimitError        (تجاوز معدل الطلبات)
 *          └─ FcaCircuitOpenError      (الدائرة مفتوحة)
 */

// ── أساس ─────────────────────────────────────────────────────────────────────

export class FcaError extends Error {
  /**
   * @param {string} message
   * @param {object} [opts]
   * @param {Error}  [opts.cause]    - الخطأ الأصلي (ES2022)
   * @param {string} [opts.code]     - رمز الخطأ
   */
  constructor(message, { cause, code } = {}) {
    super(message, { cause });
    this.name = 'FcaError';
    this.code = code ?? 'FCA_ERROR';
  }
}

// ── شبكة ─────────────────────────────────────────────────────────────────────

export class FcaNetworkError extends FcaError {
  /**
   * @param {string} message
   * @param {object} [opts]
   * @param {Error}  [opts.cause]
   * @param {string} [opts.code]
   * @param {string} [opts.threadID]
   */
  constructor(message, { cause, code, threadID } = {}) {
    super(message, { cause, code: code ?? 'NETWORK_ERROR' });
    this.name     = 'FcaNetworkError';
    this.threadID = threadID ?? null;
  }
}

export class FcaHttpError extends FcaNetworkError {
  /**
   * @param {number} status  - كود HTTP (مثل 403, 429)
   * @param {string} [url]
   * @param {object} [opts]
   * @param {Error}  [opts.cause]
   */
  constructor(status, url, { cause } = {}) {
    super(`HTTP ${status}${url ? ` — ${url}` : ''}`, {
      cause,
      code: `HTTP_${status}`,
    });
    this.name   = 'FcaHttpError';
    this.status = status;
    this.url    = url ?? null;
  }
}

// ── MQTT ─────────────────────────────────────────────────────────────────────

export class FcaMqttError extends FcaNetworkError {
  constructor(message, { cause, code } = {}) {
    super(message, { cause, code: code ?? 'MQTT_ERROR' });
    this.name = 'FcaMqttError';
  }
}

export class FcaMqttTimeoutError extends FcaMqttError {
  /** @param {number|string} requestId */
  constructor(requestId, { cause } = {}) {
    super(`MQTT ACK timeout for request ${requestId}`, {
      cause,
      code: 'MQTT_TIMEOUT',
    });
    this.name      = 'FcaMqttTimeoutError';
    this.requestId = requestId;
  }
}

export class FcaMqttNotInitializedError extends FcaMqttError {
  constructor({ cause } = {}) {
    super('MQTT client is not initialized', {
      cause,
      code: 'MQTT_NOT_INITIALIZED',
    });
    this.name = 'FcaMqttNotInitializedError';
  }
}

// ── مصادقة ───────────────────────────────────────────────────────────────────

export class FcaAuthError extends FcaError {
  constructor(message, { cause, code } = {}) {
    super(message, { cause, code: code ?? 'AUTH_ERROR' });
    this.name = 'FcaAuthError';
  }
}

export class FcaNotLoggedInError extends FcaAuthError {
  constructor({ cause } = {}) {
    super('Not logged in — session may have expired', {
      cause,
      code: 'NOT_LOGGED_IN',
    });
    this.name = 'FcaNotLoggedInError';
  }
}

// ── دورة حياة الجلسة ─────────────────────────────────────────────────────────

export class FcaSessionError extends FcaError {
  /**
   * @param {string} message
   * @param {object} [opts]
   * @param {Error}  [opts.cause]
   * @param {string} [opts.code]
   */
  constructor(message, { cause, code } = {}) {
    super(message, { cause, code: code ?? 'SESSION_ERROR' });
    this.name = 'FcaSessionError';
  }
}

/**
 * Raised when the stored fingerprint does not match the one being used.
 * A mismatch means either a store corruption or a user mixing two accounts.
 */
export class FcaFingerprintMismatchError extends FcaSessionError {
  /**
   * @param {string} expected
   * @param {string} actual
   * @param {object} [opts]
   * @param {Error}  [opts.cause]
   */
  constructor(expected, actual, { cause } = {}) {
    super(`Fingerprint mismatch: stored=${expected}, current=${actual}`, {
      cause,
      code: 'FINGERPRINT_MISMATCH',
    });
    this.name     = 'FcaFingerprintMismatchError';
    this.expected = expected;
    this.actual   = actual;
  }
}

/**
 * Raised when the encrypted session store cannot be read.
 * Common causes: missing/wrong FCA_SESSION_KEY, truncated file, tampered bytes.
 */
export class FcaStoreDecryptionError extends FcaSessionError {
  /**
   * @param {string} filePath
   * @param {object} [opts]
   * @param {Error}  [opts.cause]
   */
  constructor(filePath, { cause } = {}) {
    super(`Cannot decrypt session store: ${filePath}`, {
      cause,
      code: 'STORE_DECRYPT_FAILED',
    });
    this.name     = 'FcaStoreDecryptionError';
    this.filePath = filePath;
  }
}

// ── حماية ────────────────────────────────────────────────────────────────────

export class FcaRateLimitError extends FcaError {
  /**
   * @param {string} threadID
   * @param {number} waitMs    - مدة الانتظار المقترحة
   * @param {object} [opts]
   * @param {Error}  [opts.cause]
   */
  constructor(threadID, waitMs, { cause } = {}) {
    super(`Rate limit exceeded for thread ${threadID} — retry in ${waitMs}ms`, {
      cause,
      code: 'RATE_LIMIT',
    });
    this.name     = 'FcaRateLimitError';
    this.threadID = threadID;
    this.waitMs   = waitMs;
  }
}

export class FcaCircuitOpenError extends FcaError {
  /**
   * @param {number} retryAfterMs - متى يمكن إعادة المحاولة
   * @param {object} [opts]
   * @param {Error}  [opts.cause]
   */
  constructor(retryAfterMs, { cause } = {}) {
    super(`Circuit is OPEN — retry after ${retryAfterMs}ms`, {
      cause,
      code: 'CIRCUIT_OPEN',
    });
    this.name         = 'FcaCircuitOpenError';
    this.retryAfterMs = retryAfterMs;
  }
}

// ── تصدير موحَّد ──────────────────────────────────────────────────────────────

export default {
  FcaError,
  FcaNetworkError,
  FcaHttpError,
  FcaMqttError,
  FcaMqttTimeoutError,
  FcaMqttNotInitializedError,
  FcaAuthError,
  FcaNotLoggedInError,
  FcaSessionError,
  FcaFingerprintMismatchError,
  FcaStoreDecryptionError,
  FcaRateLimitError,
  FcaCircuitOpenError,
};

// ─── Plugin Descriptor ──────────────────────────────────────────────────────
/** @type {import('./plugin-provider.js').FcaPlugin} */
export const $plugin = {
  name: 'fca-errors',
  meta: { category: 'errors.js', path: 'lib/errors.js' },
  setup(_ctx) {
    // provides: FcaError, FcaNetworkError, FcaHttpError, FcaMqttError,
    //           FcaMqttTimeoutError, FcaMqttNotInitializedError,
    //           FcaAuthError, FcaNotLoggedInError, FcaSessionError,
    //           FcaFingerprintMismatchError, FcaStoreDecryptionError,
    //           FcaRateLimitError, FcaCircuitOpenError
  },
};