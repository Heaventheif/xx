const EMOJI = { 1:"👍",2:"❤️",3:"🤗",4:"😆",5:"😮",6:"😢",7:"😡" };
export default (defaultFuncs, api, ctx) => (storyID, react = 1, cb) => {
  let res, rej; const p = new Promise((r,j)=>{res=r;rej=j;});
  if (typeof react === "function") { cb = react; react = 1; }
  if (!cb) cb = (e) => e ? rej(e) : res();
  const emoji = EMOJI[Number(react)] || EMOJI[1];
  defaultFuncs.post("https://www.facebook.com/api/graphql/", ctx.jar, {
    fb_api_req_friendly_name: "useStoriesSendReplyMutation",
    doc_id: "4826141330837571",
    variables: JSON.stringify({ input:{ lightweight_reaction_actions:{offsets:[0],reaction:emoji}, message:emoji, story_id:storyID, story_reply_type:"LIGHT_WEIGHT", actor_id:ctx.userID, client_mutation_id:String((Math.random()*16)|0) } }),
  }).then(() => cb(null, true)).catch(e => cb(e instanceof Error ? e : new Error(JSON.stringify(e))));
  return p;
};
