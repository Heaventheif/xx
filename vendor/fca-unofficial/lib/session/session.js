export function getPageID(ctx) {
  const raw = ctx.globalOptions?.pageID ?? ctx.options?.pageID;
  if (raw === undefined || raw === null || raw === "") {
    return undefined;
  }
  return String(raw);
}
export function getMqttClient(ctx) {
  const client = ctx.mqttClient;
  if (!client || typeof client.publish !== "function") {
    return null;
  }
  return client;
}
export function hasMqttClient(ctx) {
  return Boolean(getMqttClient(ctx));
}
// SECURITY (CVE-FCA-07, Low / defense-in-depth): createSessionView() is not
// currently wired into the public api object or imported anywhere else in
// this codebase — it's dead code today, not a live vulnerability. It's
// hardened anyway because it reproduces the exact leak shape fixed in
// getAccess/getCtx (CVE-FCA-01): returning ctx and ctx.jar by reference.
// If a future command/domain calls this to build a convenience "session
// info" helper and attaches it to `api`, that would silently reintroduce
// the same full-session-credential leak. Pass `{ allowSensitive: true }`
// if a genuinely internal, trusted caller needs the raw jar/ctx.
export function createSessionView(ctx, opts = {}) {
  const base = {
    userID: ctx.userID || ctx.fbid,
    pageID: getPageID(ctx),
    hasMqttClient: hasMqttClient(ctx)
  };
  if (opts.allowSensitive === true) {
    base.ctx = ctx;
    base.options = ctx.globalOptions || ctx.options;
    base.jar = ctx.jar;
    base.mqttClient = getMqttClient(ctx);
  }
  return base;
}
export default {
  getPageID,
  getMqttClient,
  hasMqttClient,
  createSessionView
};