import { isReadableStream } from "../utils.js";
export default (defaultFuncs, api, ctx) => (image, cb) => {
  let res, rej; const p = new Promise((r,j)=>{res=r;rej=j;});
  if (!cb) cb = (e,d) => e ? rej(e) : res(d);
  if (!isReadableStream(image)) { cb(new Error("image must be a Readable stream")); return p; }
  defaultFuncs.postFormData("https://www.facebook.com/profile/picture/upload/", ctx.jar,
    { profile_id:ctx.userID, photo_source:57, av:ctx.userID, file:image })
  .then(r => {
    if (!r?.payload) throw r;
    return defaultFuncs.post("https://www.facebook.com/api/graphql", ctx.jar, {
      doc_id: "8247793861913071", server_timestamps: true,
      fb_api_req_friendly_name: "ProfileCometCoverPhotoUpdateMutation",
      variables: JSON.stringify({ input:{ cover_photo_id:r.payload.fbid, focus:{x:0.5,y:1}, target_user_id:ctx.userID, actor_id:ctx.userID, client_mutation_id:String((Math.random()*19)|0) }, scale:1, contextualProfileContext:null }),
    });
  }).then(r => cb(null, r?.data?.user_update_cover_photo?.user?.cover_photo?.photo?.url || null))
  .catch(e => cb(e instanceof Error ? e : new Error(JSON.stringify(e))));
  return p;
};
