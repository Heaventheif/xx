import { getGUID } from "../utils.js";
export default (defaultFuncs, api, ctx) => (msg, postID, cb, replyCommentID) => {
  let res, rej; const p = new Promise((r,j)=>{res=r;rej=j;});
  if (typeof cb === "string") { replyCommentID = cb; cb = null; }
  if (!cb) cb = (e,d) => e ? rej(e) : res(d);
  const text = typeof msg === "string" ? msg : (msg?.body || "");
  defaultFuncs.post("https://www.facebook.com/api/graphql/", ctx.jar, {
    fb_api_caller_class: "RelayModern",
    fb_api_req_friendly_name: "useCometUFICreateCommentMutation",
    server_timestamps: true, doc_id: 6993516810709754,
    variables: JSON.stringify({
      feedLocation:"NEWSFEED", feedbackSource:1, groupID:null,
      input:{
        client_mutation_id: String(Math.round(Math.random()*19)),
        actor_id: ctx.userID, attachments: [],
        feedback_id: Buffer.from("feedback:" + postID).toString("base64"),
        formatting_style: null,
        message: { ranges:[], text },
        reply_comment_parent_fbid: replyCommentID || null,
        reply_target_clicked: !!replyCommentID,
        attribution_id_v2: `CometHomeRoot.react,comet.home,via_cold_start,${Date.now()},156248,4748854339,,`,
        vod_video_timestamp: null, feedback_referrer:"/",
        is_tracking_encrypted: true, tracking:[], feedback_source:"NEWS_FEED",
        idempotence_token: "client:" + getGUID(), session_id: getGUID(),
      },
      inviteShortLinkKey:null, renderLocation:null, scale:1, useDefaultActor:false, focusCommentID:null,
    }),
  }).then(r => {
    if (!r || r.errors) throw new Error(r?.errors ? JSON.stringify(r.errors) : "No response");
    const edge = r.data?.comment_create?.feedback_comment_edge?.node;
    cb(null, { id:edge?.id, url:edge?.feedback?.url, count:r.data?.comment_create?.feedback?.total_comment_count });
  }).catch(e => cb(e instanceof Error ? e : new Error(JSON.stringify(e))));
  return p;
};
