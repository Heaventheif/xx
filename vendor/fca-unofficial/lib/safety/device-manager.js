import nodefs from "node:fs";
import nodepath from "node:path";
import nodecrypto from "node:crypto";
import logger from "../func/logger.js";
const __importDefault = mod => mod && mod.__esModule ? mod : {
  default: mod
};
const fs_1 = __importDefault(nodefs);
const path_1 = __importDefault(nodepath);
const crypto_1 = __importDefault(nodecrypto);
const logger_1 = __importDefault(logger);
/** Modern Chrome on Windows — the most common desktop UA in 2025. */
const DEFAULT_USER_AGENTS = ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"];
const DEFAULT_PATH = path_1.default.join(process.cwd(), ".device-profile.json");
export class DeviceManager {
  constructor(options = {}) {
    // MED-3: Validate filePath to prevent path traversal attacks.
    const rawPath = options.filePath ?? DEFAULT_PATH;
    const resolvedPath = path_1.default.resolve(rawPath);
    const allowedBase = path_1.default.resolve(process.cwd());
    if (!resolvedPath.startsWith(allowedBase + path_1.default.sep) && resolvedPath !== allowedBase) {
      throw new Error(`DeviceManager: filePath outside working directory is not allowed: ${resolvedPath}`);
    }
    this.options = {
      enabled: options.enabled !== false,
      filePath: resolvedPath,
      rotateOnStart: options.rotateOnStart ?? false
    };
    this._profile = null;
  }

  /**
   * Load an existing profile from disk, or generate and persist a new one.
   * Always returns `this` for chaining.
   */
  async init() {
    if (!this.options.enabled) return this;
    try {
      if (!this.options.rotateOnStart && fs_1.default.existsSync(this.options.filePath)) {
        const raw = fs_1.default.readFileSync(this.options.filePath, "utf8");
        this._profile = JSON.parse(raw);
        logger_1.default(`DeviceManager: loaded profile ${this._profile.deviceId}`, "info");
      } else {
        this._profile = this._generate();
        this._save();
        logger_1.default(`DeviceManager: created profile ${this._profile.deviceId}`, "info");
      }
    } catch (err) {
      logger_1.default(`DeviceManager: init failed (${err?.message}) — using ephemeral profile`, "warn");
      this._profile = this._generate();
    }
    return this;
  }

  /** Stable user-agent string for this device. */
  get userAgent() {
    return this._profile?.userAgent ?? DEFAULT_USER_AGENTS[0];
  }

  /** Opaque device identifier sent in MQTT connect options. */
  get deviceId() {
    return this._profile?.deviceId ?? "unknown";
  }

  /** Full profile object — attach to ctx.deviceProfile if needed. */
  get profile() {
    return {
      ...this._profile
    };
  }

  // ── private ──────────────────────────────────────────────────────────────

  _generate() {
    const id = crypto_1.default.randomUUID().replace(/-/g, "");
    const ua = DEFAULT_USER_AGENTS[Math.floor(Math.random() * DEFAULT_USER_AGENTS.length)];
    return {
      deviceId: `fca_${id}`,
      familyDeviceId: `fca_fam_${crypto_1.default.randomUUID().replace(/-/g, "")}`,
      userAgent: ua,
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    };
  }
  _save() {
    try {
      if (!this._profile) return;
      this._profile.lastSeenAt = new Date().toISOString();
      const dir = path_1.default.dirname(this.options.filePath);
      if (!fs_1.default.existsSync(dir)) fs_1.default.mkdirSync(dir, {
        recursive: true, mode: 0o700
      });
      // SECURITY: device profile contains device fingerprint — restrict to owner-only.
      fs_1.default.writeFileSync(this.options.filePath, JSON.stringify(this._profile, null, 2), { encoding: "utf8", mode: 0o600 });
    } catch {
      // ignore — non-critical
    }
  }
}
export function createDeviceManager(options) {
  return new DeviceManager(options);
}
export default {
  createDeviceManager,
  DeviceManager
};