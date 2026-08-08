export default (defaultFuncs, api, ctx) => (userID, doFollow = true, cb) => {
  let res, rej; const p = new Promise((r,j)=>{res=r;rej=j;});
  if (typeof doFollow === "function") { cb = doFollow; doFollow = true; }
  if (!cb) cb = (e,d) => e ? rej(e) : res(d);
  defaultFuncs.post("https://www.facebook.com/api/graphql/", ctx.jar, {
    av: ctx.userID,
    fb_api_req_friendly_name: doFollow ? "CometUserFollowMutation" : "CometUserUnfollowMutation",
    doc_id: "25472099855769847",
    variables: JSON.stringify({ input:{ subscribe_location:"PROFILE", subscribee_id:userID, actor_id:ctx.userID, client_mutation_id:"1" }, scale:1 }),
  }).then(() => cb(null, true)).catch(e => cb(e instanceof Error ? e : new Error(JSON.stringify(e))));
  return p;
};
