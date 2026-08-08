// Safety modules

// Performance modules

// Command system

import { login as __reexp_login_0 } from "./core/auth.js";
import { loginAsync as __reexp_loginAsync_1 } from "./core/auth.js";
import { loginLegacy as __reexp_loginLegacy_2 } from "./core/auth.js";
import { loginViaAPI as __reexp_loginViaAPI_3 } from "./core/auth.js";
import { tokensViaAPI as __reexp_tokensViaAPI_4 } from "./core/auth.js";
import { normalizeCookieHeaderString as __reexp_normalizeCookieHeaderString_5 } from "./core/auth.js";
import { setJarFromPairs as __reexp_setJarFromPairs_6 } from "./core/auth.js";
import { login as __reexp_login_7 } from "./core/auth.js";
import { createDefaultContext as __reexp_createDefaultContext_8 } from "./core/state.js";
import { createFcaState as __reexp_createFcaState_9 } from "./core/state.js";
import { createApiFacade as __reexp_createApiFacade_10 } from "./core/state.js";
import { createRequestHelper as __reexp_createRequestHelper_11 } from "./core/request.js";
import { listenMqtt as __reexp_listenMqtt_12 } from "./core/mqtt.js";
import { createAuthCore as __reexp_createAuthCore_13 } from "./core/auth-helpers.js";
import { defaultConfig as __reexp_defaultConfig_14 } from "./core/config.js";
import { loadConfig as __reexp_loadConfig_15 } from "./core/config.js";
import { resolveConfig as __reexp_resolveConfig_16 } from "./core/config.js";
import { writeConfigTemplate as __reexp_writeConfigTemplate_17 } from "./core/config.js";
import { attachThreadInfoRealtimeSync as __reexp_attachThreadInfoRealtimeSync_18 } from "./core/thread-info-realtime-sync.js";
import { checkForPackageUpdate as __reexp_checkForPackageUpdate_19 } from "./core/update-check.js";
import { runConfiguredUpdateCheck as __reexp_runConfiguredUpdateCheck_20 } from "./core/update-check.js";
import { createFcaClient as __reexp_createFcaClient_21 } from "./app/create-client.js";
import { MessengerBot as __reexp_MessengerBot_22 } from "./app/messenger-bot.js";
import { createMessengerBot as __reexp_createMessengerBot_23 } from "./app/messenger-bot.js";
import { MessengerContext as __reexp_MessengerContext_24 } from "./app/messenger-context.js";
import { MessengerClient as __reexp_MessengerClient_25 } from "./app/messenger-client.js";
import { createMessengerClient as __reexp_createMessengerClient_26 } from "./app/messenger-client.js";
import { attachClientFacade as __reexp_attachClientFacade_27 } from "./compat/api-registry.js";
import { createMessagesDomain as __reexp_createMessagesDomain_28 } from "./domains/messages/index.js";
import { createThreadsDomain as __reexp_createThreadsDomain_29 } from "./domains/threads/index.js";
import { createRealtimeDomain as __reexp_createRealtimeDomain_30 } from "./domains/realtime/index.js";
import { createUsersDomain as __reexp_createUsersDomain_31 } from "./domains/users/index.js";
import { createAccountDomain as __reexp_createAccountDomain_32 } from "./domains/account/index.js";
import { createHttpDomain as __reexp_createHttpDomain_33 } from "./domains/http/index.js";
import { createSchedulerDomain as __reexp_createSchedulerDomain_34 } from "./domains/scheduler/index.js";
import { createMediaDomain as __reexp_createMediaDomain_35 } from "./domains/media/index.js";
import { CookieRefresher as __reexp_CookieRefresher_36 } from "./safety/cookie-refresher.js";
import { createCookieRefresher as __reexp_createCookieRefresher_37 } from "./safety/cookie-refresher.js";
import { DeviceManager as __reexp_DeviceManager_38 } from "./safety/device-manager.js";
import { createDeviceManager as __reexp_createDeviceManager_39 } from "./safety/device-manager.js";
import { SessionGuard as __reexp_SessionGuard_40 } from "./safety/session-guard.js";
import { createSessionGuard as __reexp_createSessionGuard_41 } from "./safety/session-guard.js";
import { PerformanceManager as __reexp_PerformanceManager_42 } from "./performance/manager.js";
import { createPerformanceManager as __reexp_createPerformanceManager_43 } from "./performance/manager.js";
import { getGlobalPerformanceManager as __reexp_getGlobalPerformanceManager_44 } from "./performance/manager.js";
import { HealthMetrics as __reexp_HealthMetrics_45 } from "./performance/health-metrics.js";
import { createHealthMetrics as __reexp_createHealthMetrics_46 } from "./performance/health-metrics.js";
import { HealthServer as __reexp_HealthServer_47 } from "./performance/health-server.js";
import { createHealthServer as __reexp_createHealthServer_48 } from "./performance/health-server.js";
import { Command as __reexp_Command_49 } from "./command/registry.js";
import { CommandRegistry as __reexp_CommandRegistry_50 } from "./command/registry.js";
import { createCommandRegistry as __reexp_createCommandRegistry_51 } from "./command/registry.js";
import { FacebookSafety as __reexp_FacebookSafety_52, StealthMode as __reexp_StealthMode_53, SingleSessionGuard as __reexp_SingleSessionGuard_54, SessionLock as __reexp_SessionLock_55 } from "./safety/nexus-index.js";
import { attachNexusMethods as __reexp_attachNexusMethods_56, threadColors as __reexp_threadColors_57 } from "./nexus/index.js";
export { login } from "./core/auth.js";
export { loginAsync } from "./core/auth.js";
export { loginLegacy } from "./core/auth.js";
export { loginViaAPI } from "./core/auth.js";
export { tokensViaAPI } from "./core/auth.js";
export { normalizeCookieHeaderString } from "./core/auth.js";
export { setJarFromPairs } from "./core/auth.js";
export { createDefaultContext } from "./core/state.js";
export { createFcaState } from "./core/state.js";
export { createApiFacade } from "./core/state.js";
export { createRequestHelper } from "./core/request.js";
export { listenMqtt } from "./core/mqtt.js";
export { createAuthCore } from "./core/auth-helpers.js";
export { defaultConfig } from "./core/config.js";
export { loadConfig } from "./core/config.js";
export { resolveConfig } from "./core/config.js";
export { writeConfigTemplate } from "./core/config.js";
export { attachThreadInfoRealtimeSync } from "./core/thread-info-realtime-sync.js";
export { checkForPackageUpdate } from "./core/update-check.js";
export { runConfiguredUpdateCheck } from "./core/update-check.js";
export { createFcaClient } from "./app/create-client.js";
export { MessengerBot } from "./app/messenger-bot.js";
export { createMessengerBot } from "./app/messenger-bot.js";
export { MessengerContext } from "./app/messenger-context.js";
export { MessengerClient } from "./app/messenger-client.js";
export { createMessengerClient } from "./app/messenger-client.js";
export { attachClientFacade } from "./compat/api-registry.js";
export { createMessagesDomain } from "./domains/messages/index.js";
export { createThreadsDomain } from "./domains/threads/index.js";
export { createRealtimeDomain } from "./domains/realtime/index.js";
export { createUsersDomain } from "./domains/users/index.js";
export { createAccountDomain } from "./domains/account/index.js";
export { createHttpDomain } from "./domains/http/index.js";
export { createSchedulerDomain } from "./domains/scheduler/index.js";
export { createMediaDomain } from "./domains/media/index.js";
export { CookieRefresher } from "./safety/cookie-refresher.js";
export { createCookieRefresher } from "./safety/cookie-refresher.js";
export { DeviceManager } from "./safety/device-manager.js";
export { createDeviceManager } from "./safety/device-manager.js";
export { SessionGuard } from "./safety/session-guard.js";
export { createSessionGuard } from "./safety/session-guard.js";
export { PerformanceManager } from "./performance/manager.js";
export { createPerformanceManager } from "./performance/manager.js";
export { getGlobalPerformanceManager } from "./performance/manager.js";
export { HealthMetrics } from "./performance/health-metrics.js";
export { createHealthMetrics } from "./performance/health-metrics.js";
export { HealthServer } from "./performance/health-server.js";
export { createHealthServer } from "./performance/health-server.js";
export { Command } from "./command/registry.js";
export { CommandRegistry } from "./command/registry.js";
export { createCommandRegistry } from "./command/registry.js";
export * from "./types/index.js";

// ── Nexus additions (safety, stealth, extended API — ESM) ──────────────────
export { FacebookSafety, StealthMode, SingleSessionGuard, SessionLock } from "./safety/nexus-index.js";
export { attachNexusMethods, threadColors } from "./nexus/index.js";
export default {
  login: __reexp_login_0,
  loginAsync: __reexp_loginAsync_1,
  loginLegacy: __reexp_loginLegacy_2,
  loginViaAPI: __reexp_loginViaAPI_3,
  tokensViaAPI: __reexp_tokensViaAPI_4,
  normalizeCookieHeaderString: __reexp_normalizeCookieHeaderString_5,
  setJarFromPairs: __reexp_setJarFromPairs_6,
  default: __reexp_login_7,
  createDefaultContext: __reexp_createDefaultContext_8,
  createFcaState: __reexp_createFcaState_9,
  createApiFacade: __reexp_createApiFacade_10,
  createRequestHelper: __reexp_createRequestHelper_11,
  listenMqtt: __reexp_listenMqtt_12,
  createAuthCore: __reexp_createAuthCore_13,
  defaultConfig: __reexp_defaultConfig_14,
  loadConfig: __reexp_loadConfig_15,
  resolveConfig: __reexp_resolveConfig_16,
  writeConfigTemplate: __reexp_writeConfigTemplate_17,
  attachThreadInfoRealtimeSync: __reexp_attachThreadInfoRealtimeSync_18,
  checkForPackageUpdate: __reexp_checkForPackageUpdate_19,
  runConfiguredUpdateCheck: __reexp_runConfiguredUpdateCheck_20,
  createFcaClient: __reexp_createFcaClient_21,
  MessengerBot: __reexp_MessengerBot_22,
  createMessengerBot: __reexp_createMessengerBot_23,
  MessengerContext: __reexp_MessengerContext_24,
  MessengerClient: __reexp_MessengerClient_25,
  createMessengerClient: __reexp_createMessengerClient_26,
  attachClientFacade: __reexp_attachClientFacade_27,
  createMessagesDomain: __reexp_createMessagesDomain_28,
  createThreadsDomain: __reexp_createThreadsDomain_29,
  createRealtimeDomain: __reexp_createRealtimeDomain_30,
  createUsersDomain: __reexp_createUsersDomain_31,
  createAccountDomain: __reexp_createAccountDomain_32,
  createHttpDomain: __reexp_createHttpDomain_33,
  createSchedulerDomain: __reexp_createSchedulerDomain_34,
  createMediaDomain: __reexp_createMediaDomain_35,
  CookieRefresher: __reexp_CookieRefresher_36,
  createCookieRefresher: __reexp_createCookieRefresher_37,
  DeviceManager: __reexp_DeviceManager_38,
  createDeviceManager: __reexp_createDeviceManager_39,
  SessionGuard: __reexp_SessionGuard_40,
  createSessionGuard: __reexp_createSessionGuard_41,
  PerformanceManager: __reexp_PerformanceManager_42,
  createPerformanceManager: __reexp_createPerformanceManager_43,
  getGlobalPerformanceManager: __reexp_getGlobalPerformanceManager_44,
  HealthMetrics: __reexp_HealthMetrics_45,
  createHealthMetrics: __reexp_createHealthMetrics_46,
  HealthServer: __reexp_HealthServer_47,
  createHealthServer: __reexp_createHealthServer_48,
  Command: __reexp_Command_49,
  CommandRegistry: __reexp_CommandRegistry_50,
  createCommandRegistry: __reexp_createCommandRegistry_51,
  FacebookSafety: __reexp_FacebookSafety_52,
  StealthMode: __reexp_StealthMode_53,
  SingleSessionGuard: __reexp_SingleSessionGuard_54,
  SessionLock: __reexp_SessionLock_55,
  attachNexusMethods: __reexp_attachNexusMethods_56,
  threadColors: __reexp_threadColors_57
};