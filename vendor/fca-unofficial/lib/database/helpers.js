export const DB_NOT_INIT = "Database not initialized";
export function validateId(value, fieldName = "id") {
  if (value == null) {
    throw new Error(`${fieldName} is required and cannot be undefined`);
  }
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`Invalid ${fieldName}: must be a string or number`);
  }
  return String(value);
}
export function validateData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Invalid data: must be a non-empty object");
  }
}
export function normalizeAttributes(keys) {
  if (keys == null) return undefined;
  return typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : undefined;
}
export function normalizePayload(data, key = "data") {
  return Object.prototype.hasOwnProperty.call(data, key) ? data : {
    [key]: data
  };
}
export function wrapError(message, cause) {
  const c = cause;
  return new Error(`${message}: ${c && c.message ? c.message : cause}`);
}
export default {
  validateId,
  validateData,
  normalizeAttributes,
  normalizePayload,
  wrapError,
  DB_NOT_INIT
};