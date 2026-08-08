import format from "../../../utils/format/index.js";
var __importDefault = this && this.__importDefault || function (mod) {
  return mod && mod.__esModule ? mod : {
    "default": mod
  };
};
const format_1 = __importDefault(format);
const {
  getType
} = format_1.default;
export function createAddExternalModuleCommand(deps) {
  const {
    defaultFuncs,
    api,
    ctx
  } = deps;
  return function addExternalModule(moduleObj) {
    if (getType(moduleObj) !== "Object") {
      throw new Error(`moduleObj must be an object, not ${getType(moduleObj)}!`);
    }
    for (const apiName in moduleObj) {
      if (getType(moduleObj[apiName]) === "Function") {
        api[apiName] = moduleObj[apiName](defaultFuncs, api, ctx);
      } else {
        throw new Error(`Item "${apiName}" in moduleObj must be a function, not ${getType(moduleObj[apiName])}!`);
      }
    }
  };
}
export default {
  createAddExternalModuleCommand
};