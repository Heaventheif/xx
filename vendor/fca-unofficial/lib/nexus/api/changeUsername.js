export default (defaultFuncs, api, ctx) => (username, cb) => {
  let res, rej; const p = new Promise((r,j)=>{res=r;rej=j;});
  if (!cb) cb = (e,d) => e ? rej(e) : res(d);
  defaultFuncs.post("https://www.facebook.com/api/graphql/", ctx.jar, {
    av: ctx.userID, fb_api_req_friendly_name: "ProfileSetVanityNameMutation",
    doc_id: "23849026947175278",
    variables: JSON.stringify({ input:{ vanity:username, actor_id:ctx.userID, client_mutation_id:"1" }, scale:1 }),
  }).then(r => { if (r?.errors) throw new Error(JSON.stringify(r.errors)); cb(null, r); })
  .catch(e => cb(e instanceof Error ? e : new Error(JSON.stringify(e))));
  return p;
};
