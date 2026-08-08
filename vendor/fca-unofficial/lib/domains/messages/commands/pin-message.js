/**
 * Pin / unpin a message in a conversation via MQTT ls_req.
 * Ported from Nexus-FCA's pinMessage.js and adapted to the
 * fca-unofficial domain style.
 */

import * as ls_requests_1 from "../../../transport/realtime/ls-requests.js";
export function createPinMessageCommand(deps) {
  const {
    ctx,
    logError
  } = deps;
  /**
   * @param {boolean} pin  true = pin, false = unpin
   * @param {string} messageID
   * @param {string} threadID
   * @param {Function} [callback]
   */
  return async function pinMessage(pin, messageID, threadID, callback) {
    const cb = typeof callback === "function" ? callback : () => {};
    if (!ctx.mqttClient) {
      const err = new Error("pinMessage: MQTT not connected");
      cb(err);
      return err;
    }
    try {
      ctx.wsReqNumber = (ctx.wsReqNumber ?? 0) + 1;
      ctx.wsTaskNumber = (ctx.wsTaskNumber ?? 0) + 1;
      const label = pin ? "430" : "431";
      const queuePrefix = pin ? "pin_msg_v2_" : "unpin_msg_v2_";
      const task = {
        failure_count: null,
        label,
        payload: JSON.stringify({
          thread_key: threadID,
          message_id: messageID,
          timestamp_ms: Date.now()
        }),
        queue_name: `${queuePrefix}${threadID}`,
        task_id: ctx.wsTaskNumber
      };
      await (0, ls_requests_1.publishLsRequest)({
        client: ctx.mqttClient,
        requestNumber: ctx.wsReqNumber,
        tasks: [task]
      });
      cb(null, {
        pinned: pin,
        messageID,
        threadID
      });
      return null;
    } catch (err) {
      logError?.("pinMessage", err);
      cb(err);
      return err;
    }
  };
}
export default {
  createPinMessageCommand
};