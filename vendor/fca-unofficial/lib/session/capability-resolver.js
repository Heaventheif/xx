import * as session_1 from "./session.js";
export function resolveMarkAsReadTransport(ctx) {
  if ((0, session_1.getPageID)(ctx)) {
    return "page-http";
  }
  if ((0, session_1.hasMqttClient)(ctx)) {
    return "mqtt";
  }
  throw new Error("You can only use this function after you start listening.");
}
export function assertMqttCapability(ctx) {
  if (!(0, session_1.hasMqttClient)(ctx)) {
    throw new Error("MQTT client is not initialized");
  }
}
export function resolveThreadMutationTransport(ctx) {
  return (0, session_1.hasMqttClient)(ctx) ? "mqtt" : "http";
}
export const resolveThreadEmojiTransport = resolveThreadMutationTransport;
export default {
  resolveMarkAsReadTransport,
  assertMqttCapability,
  resolveThreadMutationTransport,
  resolveThreadEmojiTransport
};