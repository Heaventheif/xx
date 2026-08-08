// SECURITY (CVE-FCA-01, Critical): this used to hand back ctx.jar, ctx.fb_dtsg
// and ctx.jazoest — i.e. the full, live Facebook session — to *any* caller
// that has a reference to the api object. Any third-party command, plugin,
// or compromised dependency loaded into the same process could call
// api.getAccess() and walk away with full account takeover material.
//
// Session tokens are legitimately needed by a few internal features
// (CookieRefresher, SessionGuard) — those persist them to disk with
// owner-only 0600 permissions instead of handing them to arbitrary callers.
// A bot generally never needs raw cookies/tokens from *this* method: use
// api.appState() (vendor API) if you need to export a session yourself.
//
// getAccess() now only exposes non-secret identifiers. Pass
// `{ allowSensitive: true }` to opt back into the old (dangerous) behavior
// if you have a specific, trusted reason to need it — this is intentionally
// not the default and should not be enabled in bots that load third-party
// commands/plugins.
export default (defaultFuncs, api, ctx) => (opts, cb) => {
  if (typeof opts === "function") { cb = opts; opts = {}; }
  opts = opts || {};
  let res, rej; const p = new Promise((r, j) => { res = r; rej = j; });
  if (!cb) cb = (e, d) => e ? rej(e) : res(d);

  const safe = { userID: ctx.userID, region: ctx.region, logid: ctx.logid };
  if (opts.allowSensitive === true) {
    safe.jar = ctx.jar;
    safe.fb_dtsg = ctx.fb_dtsg;
    safe.jazoest = ctx.jazoest;
  }
  cb(null, safe);
  return p;
};
