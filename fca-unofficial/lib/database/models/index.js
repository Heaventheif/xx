"use strict";
/**
 * models/index.js — نسخة مُعدَّلة
 * يستخدم JSON store دائماً — تجاهل MONGO_URI و DATABASE_URL
 */
import fs   from "node:fs";
import path from "node:path";
import * as jsonStore from "../jsonStore.js";
import logger from "../../func/logger.js";

function ensureDatabaseDirectory() {
  const base = path.join(process.cwd(), "Fca_Database");
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  else { try { fs.chmodSync(base, 0o700); } catch {} }
  return base;
}

const db = {};
try {
  const dir = ensureDatabaseDirectory();
  const userStore   = new jsonStore.JsonCollection(path.join(dir, "users.json"));
  const threadStore = new jsonStore.JsonCollection(path.join(dir, "threads.json"));

  db.User    = userStore;
  db.Thread  = threadStore;
  db.isReady = true;
  db.syncAll = async () => {};
  db.flushAll = () => { userStore.flush(); threadStore.flush(); };

  logger.sys("[FCA DB] ✅ JSON store جاهز (بدون قاعدة بيانات خارجية)");
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  logger.error(`Database initialization error: ${msg}`);
  db.isReady = false;
  db.syncAll  = async () => {};
  db.flushAll = () => {};
}

export default db;

export const $plugin = {
  name:  "fca-database-models-index",
  meta:  { category: "database", path: "lib/database/models/index.js" },
  setup: (_ctx) => {},
};
