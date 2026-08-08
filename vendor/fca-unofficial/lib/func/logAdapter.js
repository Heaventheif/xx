import logger from "./logger.js";
var __importDefault = this && this.__importDefault || function (mod) {
  return mod && mod.__esModule ? mod : {
    "default": mod
  };
};
const logger_1 = __importDefault(logger);
function formatArgs(args) {
  const [prefix, msg] = args;
  if (msg === undefined) {
    if (prefix instanceof Error) {
      return prefix.stack || prefix.message || String(prefix);
    }
    return String(prefix);
  }
  const tag = prefix == null ? "" : String(prefix);
  if (msg instanceof Error) {
    const base = msg.message || String(msg);
    return tag ? `${tag}: ${base}` : base;
  }
  const text = msg == null ? "" : String(msg);
  return tag ? `${tag}: ${text}` : text;
}
const log = {
  info: (...args) => (0, logger_1.default)(formatArgs(args), "info"),
  warn: (...args) => (0, logger_1.default)(formatArgs(args), "warn"),
  error: (...args) => (0, logger_1.default)(formatArgs(args), "error"),
  verbose: (...args) => (0, logger_1.default)(formatArgs(args), "info"),
  silly: (...args) => (0, logger_1.default)(formatArgs(args), "info")
};
export default log;