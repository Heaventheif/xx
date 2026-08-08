export default (defaultFuncs, api, ctx) => async (cb) => {
  let res, rej; const p = new Promise((r,j)=>{res=r;rej=j;});
  if (!cb) cb = (e,d) => e ? rej(e) : res(d);
  try {
    const r = await defaultFuncs.get("https://www.facebook.com/profile.php?id=" + ctx.userID, ctx.jar, {});
    const body = typeof r === "string" ? r : (r?.body ? String(r.body) : "");
    const m = body.match(/"CurrentUserInitialData",\[\],\{(.*?)\}/s);
    if (m) {
      try { const d = JSON.parse("{" + m[1] + "}"); cb(null, { name:d.NAME, uid:d.USER_ID, ...d }); return p; }
      catch (_) {}
    }
    cb(null, { uid:ctx.userID });
  } catch(e) { cb(e instanceof Error ? e : new Error(String(e))); }
  return p;
};
