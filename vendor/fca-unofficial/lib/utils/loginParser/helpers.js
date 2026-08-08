export const delay = ms => new Promise(resolve => {
  setTimeout(resolve, ms);
});
export function createEmit(ctx) {
  return (event, payload) => {
    try {
      if (ctx && ctx._emitter && typeof ctx._emitter.emit === "function") {
        ctx._emitter.emit(event, payload);
      }
    } catch {
      // ignore emitter errors
    }
  };
}
export function headerOf(headers, name) {
  if (!headers) return undefined;
  const k = Object.keys(headers).find(key => key.toLowerCase() === name.toLowerCase());
  return k ? headers[k] : undefined;
}
export function buildUrl(cfg) {
  try {
    return cfg?.baseURL ? new URL(cfg.url || "/", cfg.baseURL).toString() : cfg?.url || "";
  } catch {
    return cfg?.url || "";
  }
}
export function formatCookie(arr, service) {
  const n = String(arr?.[0] || "");
  const v = String(arr?.[1] || "");
  return `${n}=${v}; Domain=.${service}.com; Path=/; Secure`;
}
export default {
  createEmit,
  headerOf,
  buildUrl,
  formatCookie,
  delay
};