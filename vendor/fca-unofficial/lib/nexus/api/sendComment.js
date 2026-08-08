export default (defaultFuncs, api, ctx) => (postID, message, cb) => {
  let res, rej; const p = new Promise((r,j)=>{res=r;rej=j;});
  if (!cb) cb = (e,d) => e ? rej(e) : res(d);
  defaultFuncs.post("https://www.facebook.com/ufi/comment/add/", ctx.jar,
    { comment_text:message, ft_ent_identifier:postID, attached_sticker_fbid:"", attached_photo_fbid:"", comment_source:2 })
  .then(r => { if (r?.error) throw new Error(JSON.stringify(r.error)); cb(null, r); })
  .catch(e => cb(e instanceof Error ? e : new Error(JSON.stringify(e))));
  return p;
};
