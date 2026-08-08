import attachment from "./attachment.js";
import cookie from "./cookie.js";
import date from "./date.js";
import decode from "./decode.js";
import delta from "./delta.js";
import ids from "./ids.js";
import message from "./message.js";
import presence from "./presence.js";
import readTyp from "./readTyp.js";
import thread from "./thread.js";
import * as utils$0 from "./utils.js";
var __createBinding = this && this.__createBinding || (Object.create ? function (o, m, k, k2) {
  if (k2 === undefined) k2 = k;
  var desc = Object.getOwnPropertyDescriptor(m, k);
  if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
    desc = {
      enumerable: true,
      get: function () {
        return m[k];
      }
    };
  }
  Object.defineProperty(o, k2, desc);
} : function (o, m, k, k2) {
  if (k2 === undefined) k2 = k;
  o[k2] = m[k];
});
var __setModuleDefault = this && this.__setModuleDefault || (Object.create ? function (o, v) {
  Object.defineProperty(o, "default", {
    enumerable: true,
    value: v
  });
} : function (o, v) {
  o["default"] = v;
});
var __importStar = this && this.__importStar || function () {
  var ownKeys = function (o) {
    ownKeys = Object.getOwnPropertyNames || function (o) {
      var ar = [];
      for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
      return ar;
    };
    return ownKeys(o);
  };
  return function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
    __setModuleDefault(result, mod);
    return result;
  };
}();
var __importDefault = this && this.__importDefault || function (mod) {
  return mod && mod.__esModule ? mod : {
    "default": mod
  };
};
const attachment_1 = __importDefault(attachment);
const cookie_1 = __importDefault(cookie);
const date_1 = __importDefault(date);
const decode_1 = __importDefault(decode);
const delta_1 = __importDefault(delta);
const ids_1 = __importDefault(ids);
const message_1 = __importDefault(message);
const presence_1 = __importDefault(presence);
const readTyp_1 = __importDefault(readTyp);
const thread_1 = __importDefault(thread);
const utils = __importStar(utils$0);
export const getType = utils.getType;
export const formatID = utils.formatID;
export const padZeros = utils.padZeros;
export const arrayToObject = utils.arrayToObject;
export const arrToForm = utils.arrToForm;
export const getData_Path = utils.getData_Path;
export const setData_Path = utils.setData_Path;
export const getPaths = utils.getPaths;
export const cleanHTML = utils.cleanHTML;
export const getCurrentTimestamp = utils.getCurrentTimestamp;
export const getSignatureID = utils.getSignatureID;
export const generateOfflineThreadingID = ids_1.default.generateOfflineThreadingID;
export const generateThreadingID = ids_1.default.generateThreadingID;
export const getGUID = ids_1.default.getGUID;
export const generateTimestampRelative = ids_1.default.generateTimestampRelative;
export const formatDate = date_1.default.formatDate;
export const presenceEncode = presence_1.default.presenceEncode;
export const presenceDecode = presence_1.default.presenceDecode;
export const generatePresence = presence_1.default.generatePresence;
export const generateAccessiblityCookie = presence_1.default.generateAccessiblityCookie;
export const formatProxyPresence = presence_1.default.formatProxyPresence;
export const formatPresence = presence_1.default.formatPresence;
export const _formatAttachment = attachment_1.default._formatAttachment;
export const formatAttachment = attachment_1.default.formatAttachment;
export const getAdminTextMessageType = delta_1.default.getAdminTextMessageType;
export const formatDeltaEvent = delta_1.default.formatDeltaEvent;
export const formatDeltaMessage = delta_1.default.formatDeltaMessage;
export const getMentionsFromDeltaMessage = delta_1.default.getMentionsFromDeltaMessage;
export const formatDeltaReadReceipt = delta_1.default.formatDeltaReadReceipt;
export const formatMessage = message_1.default.formatMessage;
export const formatEvent = message_1.default.formatEvent;
export const formatHistoryMessage = message_1.default.formatHistoryMessage;
export const formatReadReceipt = readTyp_1.default.formatReadReceipt;
export const formatRead = readTyp_1.default.formatRead;
export const formatTyp = readTyp_1.default.formatTyp;
export const formatThread = thread_1.default.formatThread;
export const decodeClientPayload = decode_1.default.decodeClientPayload;
export const formatCookie = cookie_1.default.formatCookie;
export default {
  getType,
  formatID,
  padZeros,
  arrayToObject,
  arrToForm,
  getData_Path,
  setData_Path,
  getPaths,
  cleanHTML,
  getCurrentTimestamp,
  getSignatureID,
  generateOfflineThreadingID,
  generateThreadingID,
  getGUID,
  generateTimestampRelative,
  formatDate,
  presenceEncode,
  presenceDecode,
  generatePresence,
  generateAccessiblityCookie,
  formatProxyPresence,
  formatPresence,
  _formatAttachment,
  formatAttachment,
  getAdminTextMessageType,
  formatDeltaEvent,
  formatDeltaMessage,
  getMentionsFromDeltaMessage,
  formatDeltaReadReceipt,
  formatMessage,
  formatEvent,
  formatHistoryMessage,
  formatReadReceipt,
  formatRead,
  formatTyp,
  formatThread,
  decodeClientPayload,
  formatCookie
};