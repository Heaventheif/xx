import stream from "stream";
import format from "./format/index.js";
var __importDefault = this && this.__importDefault || function (mod) {
  return mod && mod.__esModule ? mod : {
    "default": mod
  };
};
const stream_1 = __importDefault(stream);
const format_1 = __importDefault(format);
const formatMod = format_1.default;
const getType = typeof formatMod === "function" ? formatMod : formatMod.getType || (value => Object.prototype.toString.call(value).slice(8, -1));
export function getFrom(html, startToken, endToken) {
  const i = html.indexOf(startToken);
  if (i < 0) return undefined;
  const start = i + startToken.length;
  const j = html.indexOf(endToken, start);
  return j < 0 ? undefined : html.slice(start, j);
}
export function isReadableStream(obj) {
  const maybe = obj;
  return Boolean(obj instanceof stream_1.default.Stream && (getType(maybe._read) === "Function" || getType(maybe._read) === "AsyncFunction") && getType(maybe._readableState) === "Object");
}
export default {
  getFrom,
  isReadableStream
};