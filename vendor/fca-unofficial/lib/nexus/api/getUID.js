export default (defaultFuncs, api, ctx) => (link, cb) => {
  let res, rej; const p = new Promise((r,j)=>{res=r;rej=j;});
  if (!cb) cb = (e,d) => e ? rej(e) : res(d);
  let url;
  try { url = new URL(link.startsWith("http") ? link : "https://www.facebook.com/" + link).href; }
  catch (_) { cb(new Error("Invalid URL: " + link)); return p; }
  defaultFuncs.get(url, ctx.jar, {}).then(r => {
    const body = typeof r === "string" ? r : (r?.body ? String(r.body) : "");
    const m = body.match(/"userID"\s*:\s*"(\d+)"/)
            || body.match(/profile_id=(\d+)/)
            || body.match(/"owner"\s*:\s*\{[^}]*"id"\s*:\s*"(\d+)"/)
            || body.match(/entity_id=(\d+)/);
    if (!m) { cb(new Error("Could not find UID for: " + link)); return; }
    cb(null, m[1]);
  }).catch(e => cb(e instanceof Error ? e : new Error(String(e))));
  return p;
};
