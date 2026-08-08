import format from "../format/index.js";
var __importDefault = this && this.__importDefault || function (mod) {
  return mod && mod.__esModule ? mod : {
    "default": mod
  };
};
const format_1 = __importDefault(format);
const formatNs = format_1.default;
export const getType = typeof formatNs === "function" ? formatNs : formatNs.getType || (value => Object.prototype.toString.call(value).slice(8, -1));
export function toStringVal(v) {
  if (v === undefined || v === null) return "";
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}
export function isStream(v) {
  return Boolean(v && typeof v === "object" && typeof v.pipe === "function" && typeof v.on === "function");
}
export function isBlobLike(v) {
  return Boolean(v && typeof v === "object" && typeof v.arrayBuffer === "function" && (typeof v.type === "string" || typeof v.name === "string"));
}
export function isPairArrayList(arr) {
  return Array.isArray(arr) && arr.length > 0 && arr.every(x => Array.isArray(x) && x.length === 2 && typeof x[0] === "string");
}
export default {
  toStringVal,
  isStream,
  isBlobLike,
  isPairArrayList,
  getType
};