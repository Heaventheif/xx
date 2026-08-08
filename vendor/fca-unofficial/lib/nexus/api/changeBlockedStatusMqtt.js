export default (defaultFuncs, api, ctx) => (userID, block, cb) => {
  let res, rej; const p = new Promise((r,j)=>{res=r;rej=j;});
  if (!cb) cb = (e,d) => e ? rej(e) : res(d);
  defaultFuncs.post("https://www.facebook.com/messaging/block_messages/", ctx.jar,
    { uid:userID, block_user:block?1:0, log_in_blocking_flow:false, is_messing_blocked:false })
  .then(r => { if (r?.error) throw new Error(JSON.stringify(r.error)); cb(null, r); })
  .catch(e => cb(e instanceof Error ? e : new Error(JSON.stringify(e))));
  return p;
};
