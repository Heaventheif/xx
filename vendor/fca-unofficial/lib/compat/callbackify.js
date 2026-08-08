export function ensureNodeCallback(callback) {
  return typeof callback === "function" ? callback : () => {};
}
export default {
  ensureNodeCallback
};