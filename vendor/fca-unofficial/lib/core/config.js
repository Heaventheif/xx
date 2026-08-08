import nodefs from "node:fs";
import nodepath from "node:path";
import logger from "../func/logger.js";
var __importDefault = this && this.__importDefault || function (mod) {
  return mod && mod.__esModule ? mod : {
    "default": mod
  };
};
const node_fs_1 = __importDefault(nodefs);
const node_path_1 = __importDefault(nodepath);
const logger_1 = __importDefault(logger);
const DEFAULT_REGISTRY_URL = "https://registry.npmjs.org";
const DEFAULT_PACKAGE_NAME = "";
export const defaultConfig = {
  autoUpdate: false,
  checkUpdate: {
    enabled: false,
    install: false,
    notifyIfCurrent: false,
    packageName: DEFAULT_PACKAGE_NAME,
    registryUrl: DEFAULT_REGISTRY_URL,
    timeoutMs: 10000
  },
  mqtt: {
    enabled: true,
    reconnectInterval: 3600
  },
  autoLogin: false,
  apiServer: "",
  apiKey: "",
  credentials: {
    email: "",
    password: "",
    twofactor: ""
  },
  antiGetInfo: {
    AntiGetThreadInfo: false,
    AntiGetUserInfo: false
  },
  // ========== إضافة جديدة لمكافحة الكشف ==========
  antiDetection: {
    enabled: false,
    requestDelayMin: 0,
    requestDelayMax: 0,
    userAgentPool: []
  },
  // ============================================
  remoteControl: {
    enabled: false,
    url: "",
    token: "",
    autoReconnect: true
  }
};
// SECURITY: block prototype-pollution keys. Config can originate from
// JSON.parse (fca-config.json) or caller-supplied objects, and JSON.parse
// happily produces an own, enumerable "__proto__" property. Object.entries
// picks that up, and a later `result[key] = value` bracket assignment would
// invoke the inherited __proto__ *setter* and swap the object's actual
// prototype instead of just adding a property.
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function cloneConfig(value) {
  if (Array.isArray(value)) {
    return value.map(item => cloneConfig(item));
  }
  if (isPlainObject(value)) {
    // Object.fromEntries is already safe here (it uses CreateDataProperty
    // internally, not the [[Set]] path), but we still skip dangerous keys
    // explicitly so a "__proto__" entry can never survive into the clone.
    return Object.fromEntries(Object.entries(value).filter(([key]) => !DANGEROUS_KEYS.has(key)).map(([key, item]) => [key, cloneConfig(item)]));
  }
  return value;
}
function deepMerge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? cloneConfig(base) : cloneConfig(override);
  }
  const result = cloneConfig(base);
  for (const [key, value] of Object.entries(override)) {
    if (DANGEROUS_KEYS.has(key)) {
      continue;
    }
    const current = result[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      result[key] = deepMerge(current, value);
    } else {
      result[key] = cloneConfig(value);
    }
  }
  return result;
}
function normalizeBoolean(value, fallback) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return fallback;
}
function normalizeNumber(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}
function normalizeString(value, fallback) {
  return typeof value === "string" ? value : fallback;
}
export function resolveConfig(input) {
  const rawInput = isPlainObject(input) ? input : {};
  const rawCheckUpdate = isPlainObject(rawInput.checkUpdate) ? rawInput.checkUpdate : {};
  const merged = deepMerge(defaultConfig, input || {});
  const config = merged;
  config.credentials = deepMerge(defaultConfig.credentials, config.credentials || {});
  config.mqtt = deepMerge(defaultConfig.mqtt, config.mqtt || {});
  config.antiGetInfo = deepMerge(defaultConfig.antiGetInfo, config.antiGetInfo || {});
  config.remoteControl = deepMerge(defaultConfig.remoteControl, config.remoteControl || {});
  config.checkUpdate = deepMerge(defaultConfig.checkUpdate, config.checkUpdate || {});
  // ========== معالجة إعدادات مكافحة الكشف ==========
  config.antiDetection = deepMerge(defaultConfig.antiDetection, config.antiDetection || {});
  config.antiDetection.enabled = normalizeBoolean(config.antiDetection.enabled, false);
  config.antiDetection.requestDelayMin = normalizeNumber(config.antiDetection.requestDelayMin, 0);
  config.antiDetection.requestDelayMax = normalizeNumber(config.antiDetection.requestDelayMax, 0);
  if (!Array.isArray(config.antiDetection.userAgentPool)) {
    config.antiDetection.userAgentPool = [];
  }
  // ===============================================
  config.autoLogin = normalizeBoolean(config.autoLogin, defaultConfig.autoLogin);
  config.autoUpdate = normalizeBoolean(rawInput.autoUpdate, defaultConfig.autoUpdate);
  config.mqtt.enabled = normalizeBoolean(config.mqtt.enabled, defaultConfig.mqtt.enabled);
  config.mqtt.reconnectInterval = normalizeNumber(config.mqtt.reconnectInterval, defaultConfig.mqtt.reconnectInterval);
  config.remoteControl.enabled = normalizeBoolean(config.remoteControl.enabled, defaultConfig.remoteControl.enabled);
  config.remoteControl.autoReconnect = normalizeBoolean(config.remoteControl.autoReconnect, defaultConfig.remoteControl.autoReconnect);
  config.antiGetInfo.AntiGetThreadInfo = normalizeBoolean(config.antiGetInfo.AntiGetThreadInfo, defaultConfig.antiGetInfo.AntiGetThreadInfo);
  config.antiGetInfo.AntiGetUserInfo = normalizeBoolean(config.antiGetInfo.AntiGetUserInfo, defaultConfig.antiGetInfo.AntiGetUserInfo);
  config.checkUpdate.enabled = normalizeBoolean(rawCheckUpdate.enabled, config.autoUpdate);
  config.checkUpdate.install = normalizeBoolean(config.checkUpdate.install, defaultConfig.checkUpdate.install);
  config.checkUpdate.notifyIfCurrent = normalizeBoolean(config.checkUpdate.notifyIfCurrent, defaultConfig.checkUpdate.notifyIfCurrent);
  config.checkUpdate.packageName = normalizeString(config.checkUpdate.packageName, defaultConfig.checkUpdate.packageName);
  config.checkUpdate.registryUrl = normalizeString(config.checkUpdate.registryUrl, defaultConfig.checkUpdate.registryUrl);
  config.checkUpdate.timeoutMs = Math.max(1000, normalizeNumber(config.checkUpdate.timeoutMs, defaultConfig.checkUpdate.timeoutMs));
  config.autoUpdate = config.checkUpdate.enabled;
  return config;
}
export function getConfigPath() {
  return node_path_1.default.join(process.cwd(), "fca-config.json");
}
export function loadConfig() {
  const configPath = getConfigPath();
  if (!node_fs_1.default.existsSync(configPath)) {
    return {
      config: resolveConfig(defaultConfig),
      configPath,
      exists: false
    };
  }
  try {
    const fileContent = node_fs_1.default.readFileSync(configPath, "utf8");
    if (fileContent.trim() === "") {
      return {
        config: resolveConfig(defaultConfig),
        configPath,
        exists: true
      };
    }
    const parsed = JSON.parse(fileContent);
    return {
      config: resolveConfig(parsed),
      configPath,
      exists: true
    };
  } catch (err) {
    (0, logger_1.default)(`Error reading config file, using defaults: ${err.message}`, "warn");
    return {
      config: resolveConfig(defaultConfig),
      configPath,
      exists: true
    };
  }
}
export function writeConfigTemplate(targetPath = node_path_1.default.join(process.cwd(), "fca-config.example.json")) {
  const payload = `${JSON.stringify(defaultConfig, null, 2)}\n`;
  node_fs_1.default.writeFileSync(targetPath, payload, "utf8");
  return targetPath;
}
export default {
  resolveConfig,
  getConfigPath,
  loadConfig,
  writeConfigTemplate,
  defaultConfig
};