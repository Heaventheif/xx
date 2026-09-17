"use strict";

// Detailed bug logging is disabled by default. Enable only with DEV=on.
const enabled = String(process.env.DEV || "").trim().toLowerCase() === "on";
const original = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};
const SECRET_KEY = /(appstate|cookie|token|authorization|password|secret|api[_-]?key|database_url|mongo_uri)/i;

function redact(value, key = "") {
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redact(item));
  if (value && typeof value === "object") {
    const result = {};
    for (const [childKey, childValue] of Object.entries(value).slice(0, 100)) {
      result[childKey] = redact(childValue, childKey);
    }
    return result;
  }
  if (typeof value === "string" && value.length > 4000) return `${value.slice(0, 4000)}…[truncated]`;
  return value;
}

function stringify(values) {
  return values.map((value) => {
    if (typeof value === "string") return value.length > 4000 ? `${value.slice(0, 4000)}…[truncated]` : value;
    try { return JSON.stringify(redact(value)); } catch { return String(value); }
  }).join(" ");
}

function bugLog(source, ...values) {
  if (!enabled) return;
  const timestamp = new Date().toISOString();
  original.log(`[BUG][${timestamp}][${String(source || "app")}] ${stringify(values)}`);
}

globalThis.__DEV_DEBUG__ = enabled;
globalThis.__bugLog = bugLog;

if (enabled) {
  // Prefix every console event, making Render logs searchable by [BUG].
  for (const [level, writer] of Object.entries(original)) {
    console[level] = (...values) => {
      writer(`[BUG][${new Date().toISOString()}][console.${level}]`, stringify(values));
    };
  }
  bugLog("debug", "Detailed DEV diagnostics enabled; sensitive values are redacted.");
}

export { enabled, bugLog, redact };
export default { enabled, bugLog, redact };
