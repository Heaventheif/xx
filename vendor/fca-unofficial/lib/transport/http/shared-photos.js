import * as client_1 from "../../utils/client.js";
const SHARED_PHOTOS_URL = "https://www.facebook.com/ajax/messaging/attachments/sharedphotos.php";
export async function postSharedPhotosRequest(params) {
  const {
    defaultFuncs,
    ctx,
    form
  } = params;
  return defaultFuncs.post(SHARED_PHOTOS_URL, ctx.jar, form).then((0, client_1.parseAndCheckLogin)(ctx, defaultFuncs));
}
export default {
  postSharedPhotosRequest
};