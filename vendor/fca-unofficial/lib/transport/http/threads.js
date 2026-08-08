import * as facebook_1 from "./facebook.js";
import * as client_1 from "../../utils/client.js";
export async function changeThreadMuteViaMercury(params) {
  const {
    defaultFuncs,
    ctx,
    threadID,
    muteSeconds
  } = params;
  return defaultFuncs.post("https://www.facebook.com/ajax/mercury/change_mute_thread.php", ctx.jar, {
    thread_fbid: threadID,
    mute_settings: muteSeconds
  }).then((0, client_1.saveCookies)(ctx.jar)).then((0, client_1.parseAndCheckLogin)(ctx, defaultFuncs));
}
export async function setThreadTitleViaHttp(params) {
  const {
    defaultFuncs,
    ctx,
    form
  } = params;
  return defaultFuncs.post("https://www.facebook.com/messaging/set_thread_name/", ctx.jar, form).then((0, client_1.parseAndCheckLogin)(ctx, defaultFuncs));
}
export async function searchThreadsViaMercury(params) {
  const {
    defaultFuncs,
    ctx,
    query
  } = params;
  return defaultFuncs.post("https://www.facebook.com/ajax/mercury/search_threads.php", ctx.jar, {
    client: "web_messenger",
    query,
    offset: 0,
    limit: 21,
    index: "fbid"
  }).then((0, client_1.parseAndCheckLogin)(ctx, defaultFuncs));
}
export async function changeThreadEmojiViaHttp(params) {
  const {
    defaultFuncs,
    ctx,
    emoji,
    threadID
  } = params;
  return defaultFuncs.post("https://www.facebook.com/messaging/save_thread_emoji/?source=thread_settings&__pc=EXP1%3Amessengerdotcom_pkg", ctx.jar, {
    emoji_choice: emoji,
    thread_or_other_fbid: threadID
  }).then((0, client_1.parseAndCheckLogin)(ctx, defaultFuncs));
}
export async function uploadGroupImageViaMercury(params) {
  const {
    defaultFuncs,
    ctx,
    image
  } = params;
  return defaultFuncs.postFormData("https://www.facebook.com/ajax/mercury/upload.php", ctx.jar, {
    images_only: "true",
    fb_dtsg: ctx.fb_dtsg,
    "attachment[]": image
  }, {}).then((0, client_1.parseAndCheckLogin)(ctx, defaultFuncs));
}
export async function changeArchivedStatusViaMercury(params) {
  const {
    defaultFuncs,
    ctx,
    form
  } = params;
  return defaultFuncs.post("https://www.facebook.com/ajax/mercury/change_archived_status.php", ctx.jar, form).then((0, client_1.parseAndCheckLogin)(ctx, defaultFuncs));
}
export async function moveThreadsViaMercury(params) {
  const {
    defaultFuncs,
    ctx,
    form
  } = params;
  return defaultFuncs.post("https://www.facebook.com/ajax/mercury/move_thread.php", ctx.jar, form).then((0, client_1.parseAndCheckLogin)(ctx, defaultFuncs));
}
export async function deleteThreadsViaMercury(params) {
  const {
    defaultFuncs,
    ctx,
    threadIDs
  } = params;
  const form = {
    client: "mercury"
  };
  threadIDs.forEach((threadID, index) => {
    form[`ids[${index}]`] = threadID;
  });
  return (0, facebook_1.postWithLoginCheck)({
    defaultFuncs,
    ctx,
    url: "https://www.facebook.com/ajax/mercury/delete_thread.php",
    form
  });
}
export default {
  changeThreadMuteViaMercury,
  setThreadTitleViaHttp,
  searchThreadsViaMercury,
  changeThreadEmojiViaHttp,
  uploadGroupImageViaMercury,
  changeArchivedStatusViaMercury,
  moveThreadsViaMercury,
  deleteThreadsViaMercury
};