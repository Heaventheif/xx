import * as listener_1 from "./listener.js";
export function createRealtimeDomain(deps) {
  return {
    listen: (0, listener_1.createRealtimeListener)(deps)
  };
}
export * from "./listener.js";
export * from "./middleware.js";
export default {
  createRealtimeDomain
};