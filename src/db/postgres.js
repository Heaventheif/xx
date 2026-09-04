"use strict";
import crypto from "crypto";
import chalk from "chalk";
let pool = null;
let encryptionKey = null; 
let schemaReady = false;
function isEnabled() {
  return !!pool;
}
function deriveKey(secret) {
  return crypto.scryptSync(String(secret), "appstate-vault-v1", 32);
}
async function init() {
  const connStr = process.env.DATABASE_URL || "";
  if (!connStr) return; 
  const secret = process.env.APPSTATE_ENCRYPTION_KEY;
  if (!secret) {
    console.error(chalk.red(
      "[APPSTATE-VAULT] ❌ DATABASE_URL موجود لكن APPSTATE_ENCRYPTION_KEY غير مضبوط — " +
      "لن يتم تفعيل الخزنة المشفّرة تفادياً لتخزين AppState بدون تشفير. أضف مفتاحاً طويلاً وعشوائياً."
    ));
    return;
  }
  try {
    const { Pool } = await import("pg");
    pool = new Pool({
      connectionString: connStr,
      ssl: connStr.includes("sslmode=") ? undefined : { rejectUnauthorized: false },
    });
    encryptionKey = deriveKey(secret);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS appstate_vault (
        bot_index   INTEGER PRIMARY KEY,
        owner       TEXT NOT NULL,
        bot_name    TEXT,
        iv          TEXT NOT NULL,
        auth_tag    TEXT NOT NULL,
        ciphertext  TEXT NOT NULL,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS appstate_vault_owner_idx ON appstate_vault (owner);`);
    schemaReady = true;
    console.log(chalk.green("[APPSTATE-VAULT] ✅ متصل بـ Neon/Postgres — AppState تُخزَّن مشفّرة ومعزولة لكل مستخدم."));
  } catch (e) {
    console.error(chalk.red("[APPSTATE-VAULT] ❌ فشل الاتصال بـ Postgres (DATABASE_URL):"), e.message);
    pool = null;
  }
}
function encrypt(plaintextObj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
  const plaintext = Buffer.from(JSON.stringify(plaintextObj), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}
function decrypt({ iv, authTag, ciphertext }) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8"));
}
async function saveAppState(botIndex, owner, appstateArray, botName = null) {
  if (!isEnabled() || !schemaReady) return false;
  const { iv, authTag, ciphertext } = encrypt(appstateArray);
  try {
    await pool.query(
      `INSERT INTO appstate_vault (bot_index, owner, bot_name, iv, auth_tag, ciphertext, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (bot_index)
       DO UPDATE SET owner = $2, bot_name = COALESCE($3, appstate_vault.bot_name),
                     iv = $4, auth_tag = $5, ciphertext = $6, updated_at = now()`,
      [botIndex, owner, botName, iv, authTag, ciphertext]
    );
    return true;
  } catch (e) {
    console.error(chalk.red("[APPSTATE-VAULT] ❌ فشل حفظ AppState في Postgres:"), e.message);
    return false;
  }
}
async function updateBotName(botIndex, botName) {
  if (!isEnabled() || !schemaReady || !botName) return;
  try {
    await pool.query(`UPDATE appstate_vault SET bot_name = $2 WHERE bot_index = $1`, [botIndex, botName]);
  } catch (e) {
    console.warn(chalk.yellow("[APPSTATE-VAULT] ⚠️ فشل تحديث اسم الحساب في Postgres:"), e.message);
  }
}
async function loadAll() {
  if (!isEnabled() || !schemaReady) return [];
  try {
    const { rows } = await pool.query(`SELECT bot_index, owner, bot_name, iv, auth_tag, ciphertext FROM appstate_vault`);
    return rows.map((r) => {
      try {
        return {
          index: r.bot_index,
          owner: r.owner,
          botName: r.bot_name,
          state: decrypt({ iv: r.iv, authTag: r.auth_tag, ciphertext: r.ciphertext }),
        };
      } catch (e) {
        console.error(chalk.red(`[APPSTATE-VAULT] ❌ فشل فك تشفير الحساب #${r.bot_index} (مفتاح خاطئ؟):`), e.message);
        return null;
      }
    }).filter(Boolean);
  } catch (e) {
    console.error(chalk.red("[APPSTATE-VAULT] ❌ فشل قراءة AppState من Postgres:"), e.message);
    return [];
  }
}
async function loadForOwner(owner) {
  if (!isEnabled() || !schemaReady) return [];
  try {
    const { rows } = await pool.query(
      `SELECT bot_index, bot_name FROM appstate_vault WHERE owner = $1 ORDER BY bot_index`,
      [owner]
    );
    return rows.map((r) => ({ index: r.bot_index, botName: r.bot_name }));
  } catch (e) {
    console.error(chalk.red("[APPSTATE-VAULT] ❌ فشل جلب حسابات المستخدم من Postgres:"), e.message);
    return [];
  }
}
async function deleteAppState(botIndex, owner) {
  if (!isEnabled() || !schemaReady) return false;
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM appstate_vault WHERE bot_index = $1 AND owner = $2`,
      [botIndex, owner]
    );
    return rowCount > 0;
  } catch (e) {
    console.error(chalk.red("[APPSTATE-VAULT] ❌ فشل حذف الحساب من Postgres:"), e.message);
    return false;
  }
}
async function isOwnedBy(botIndex, owner) {
  if (!isEnabled() || !schemaReady) return null; 
  try {
    const { rows } = await pool.query(`SELECT owner FROM appstate_vault WHERE bot_index = $1`, [botIndex]);
    if (!rows.length) return null;
    return rows[0].owner === owner;
  } catch {
    return null;
  }
}
export {
  init,
  isEnabled,
  saveAppState,
  updateBotName,
  loadAll,
  loadForOwner,
  deleteAppState,
  isOwnedBy,
};
