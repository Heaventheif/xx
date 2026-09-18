/**
 * Public entry point for the local fca-unofficial package.
 *
 * Keep this file explicit: the old generated placeholder contained patch
 * instructions instead of exports, which made `import "fca-unofficial"`
 * fail before a login could even start.
 */
export {
  default as login,
  loginAsync,
  loginLegacy,
  loginViaAPI,
  tokensViaAPI,
  normalizeCookieHeaderString,
  setJarFromPairs,
  installProcessHandlers,
} from "./core/auth.js";

export {
  defaultConfig,
  getConfigPath,
  loadConfig,
  resolveConfig,
  writeConfigTemplate,
} from "./core/config.js";

export { attachNexusMethods } from "./nexus/index.js";
export {
  getGlobalPerformanceManager,
  createPerformanceManager,
  PerformanceManager,
} from "./performance/manager.js";
export { createCookieRefresher } from "./safety/cookie-refresher.js";
export { DeviceManager, createDeviceManager } from "./safety/device-manager.js";
export { createSessionGuard, SessionGuard } from "./safety/session-guard.js";
export { SingleSessionGuard } from "./safety/SingleSessionGuard.js";
export { StealthMode, createStealthMode } from "./safety/StealthMode.js";
export { attachThreadInfoRealtimeSync } from "./core/thread-info-realtime-sync.js";
export { createSchedulerDomain } from "./domains/scheduler/index.js";
export {
  SessionManager,
  FileStorage,
  MemoryStorage,
} from "./session/session-manager.js";
export {
  loadPersistentFingerprint,
  savePersistentFingerprint,
  applyPersistentFingerprintToCtx,
} from "./safety/persistent-fingerprint.js";

export * from "./errors.js";

// ── إعداد البوت (نُقل من src/core/Client.js) ─────────────────────────────────
export { startMqttListener, initBotLifecycle } from "./app/bot-init.js";
