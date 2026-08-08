"use strict";

import fs from "fs-extra";
import path from "path";
import chalk from "chalk";

// appstate.json lives at the project root, one level up from utils/.
const APPSTATE_PATH = path.join(import.meta.dir, "..", "appstate.json");

// Persist the Facebook login session state to disk.
function saveAppState(state) {
  try {
    fs.writeFileSync(APPSTATE_PATH, JSON.stringify(state, null, 2), "utf8");
    try { fs.chmodSync(APPSTATE_PATH, 0o600); } catch (_) {}
    console.log(chalk.green("[SESSION] 💾 appstate.json محفوظ بنجاح"));
  } catch (err) {
    console.error(chalk.red("[SESSION] ❌ فشل حفظ appstate:", err.message));
  }
}

export { saveAppState, APPSTATE_PATH };
