// SECURITY (CVE-FCA-01, Critical): this used to return the *live* internal
// ctx object by reference — jar (cookies), fb_dtsg, jazoest, globalOptions
// (which can hold proxy credentials), mqttClient, everything. Any caller
// with the api object could exfiltrate the full session, and could also
// mutate internal state directly (e.g. ctx.jar = ...), bypassing every
// other safety module in this library.
//
// getCtx() now returns a shallow, read-only-in-spirit snapshot with secrets
// stripped. Pass `{ allowSensitive: true }` to opt into the old raw
// reference — not recommended in a process that loads third-party
// commands/plugins.
export default (defaultFuncs, api, ctx) => (opts = {}) => {
  if (opts && opts.allowSensitive === true) {
    return ctx;
  }
  const { jar, fb_dtsg, jazoest, ...safeRest } = ctx || {};
  return { ...safeRest };
};
