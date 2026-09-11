"use strict";
import crypto from "crypto";
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
    console.error(
      "[APPSTATE-VAULT] ❌ DATABASE_URL موجود لكن APPSTATE_ENCRYPTION_KEY غير مضبوط — " +
      "لن يتم تفعيل الخزنة المشفّرة تفادياً لتخزين AppState بدون تشفير. أضف مفتاحاً طويلاً وعشوائياً."
    );
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
        admin_fb_id TEXT,
        bot_fb_id   TEXT,
        iv          TEXT NOT NULL,
        auth_tag    TEXT NOT NULL,
        ciphertext  TEXT NOT NULL,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    // Migrations: add columns to existing tables without them
    await pool.query(`ALTER TABLE appstate_vault ADD COLUMN IF NOT EXISTS admin_fb_id TEXT;`);
    await pool.query(`ALTER TABLE appstate_vault ADD COLUMN IF NOT EXISTS bot_fb_id TEXT;`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS appstate_vault_bot_fb_id_idx ON appstate_vault (bot_fb_id) WHERE bot_fb_id IS NOT NULL;`);
    await pool.query(`CREATE INDEX IF NOT EXISTS appstate_vault_owner_idx ON appstate_vault (owner);`);
    schemaReady = true;
    console.log("[APPSTATE-VAULT] ✅ متصل بـ Neon/Postgres — AppState تُخزَّن مشفّرة ومعزولة لكل مستخدم.");
  } catch (e) {
    console.error("[APPSTATE-VAULT] ❌ فشل الاتصال بـ Postgres (DATABASE_URL):", e.message);
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
async function saveAppState(botIndex, owner, appstateArray, botName = null, adminFbId = null, botFbId = null) {
  if (!isEnabled() || !schemaReady) return false;
  const { iv, authTag, ciphertext } = encrypt(appstateArray);
  try {
    // [FIX DUPLICATE-SESSION] We intentionally exclude bot_fb_id from the
    // INSERT and DO UPDATE paths here to avoid the unique constraint violation
    // that occurs when the same Facebook account is loaded under multiple bot
    // indexes (duplicate appstate files).  bot_fb_id is managed exclusively
    // by updateBotFbId(), which already has a NOT EXISTS guard.
    await pool.query(
      `INSERT INTO appstate_vault (bot_index, owner, bot_name, admin_fb_id, iv, auth_tag, ciphertext, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (bot_index)
       DO UPDATE SET owner       = EXCLUDED.owner,
                     bot_name    = COALESCE(EXCLUDED.bot_name, appstate_vault.bot_name),
                     admin_fb_id = COALESCE(EXCLUDED.admin_fb_id, appstate_vault.admin_fb_id),
                     iv          = EXCLUDED.iv,
                     auth_tag    = EXCLUDED.auth_tag,
                     ciphertext  = EXCLUDED.ciphertext,
                     updated_at  = now()`,
      [botIndex, owner, botName, adminFbId, iv, authTag, ciphertext]
    );
    // Update bot_fb_id separately via the conflict-safe helper
    if (botFbId) await updateBotFbId(botIndex, botFbId);
    return true;
  } catch (e) {
    console.error("[APPSTATE-VAULT] ❌ فشل حفظ AppState في Postgres:", e.message);
    return false;
  }
}
async function updateBotName(botIndex, botName) {
  if (!isEnabled() || !schemaReady || !botName) return;
  try {
    await pool.query(`UPDATE appstate_vault SET bot_name = $2 WHERE bot_index = $1`, [botIndex, botName]);
  } catch (e) {
    console.warn("[APPSTATE-VAULT] ⚠️ فشل تحديث اسم الحساب في Postgres:", e.message);
  }
}
/**
 * Store the bot's own Facebook user ID so the same account is always
 * identified by its real FB ID and never duplicated in the vault.
 */
async function updateBotFbId(botIndex, botFbId) {
  if (!isEnabled() || !schemaReady || !botFbId) return;
  try {
    // Guard: only update if no OTHER row already owns this FB ID.
    // This prevents the unique constraint violation when the same Facebook
    // account is loaded under multiple bot indexes (duplicate appstate files).
    await pool.query(
      `UPDATE appstate_vault
          SET bot_fb_id  = $2,
              updated_at = now()
        WHERE bot_index  = $1
          AND (bot_fb_id IS NULL OR bot_fb_id = $2)
          AND NOT EXISTS (
            SELECT 1 FROM appstate_vault
             WHERE bot_fb_id = $2
               AND bot_index != $1
          )`,
      [botIndex, String(botFbId)]
    );
  } catch (e) {
    console.warn("[APPSTATE-VAULT] ⚠️ فشل تحديث bot_fb_id في Postgres:", e.message);
  }
}
async function loadAll() {
  if (!isEnabled() || !schemaReady) return [];
  try {
    const { rows } = await pool.query(`SELECT bot_index, owner, bot_name, admin_fb_id, bot_fb_id, iv, auth_tag, ciphertext, updated_at FROM appstate_vault`);
    return rows.map((r) => {
      try {
        return {
          index: r.bot_index,
          owner: r.owner,
          botName: r.bot_name,
          adminFbId: r.admin_fb_id || null,
          botFbId: r.bot_fb_id || null,
          updatedAt: r.updated_at || null,
          state: decrypt({ iv: r.iv, authTag: r.auth_tag, ciphertext: r.ciphertext }),
        };
      } catch (e) {
        console.error(`[APPSTATE-VAULT] ❌ فشل فك تشفير الحساب #${r.bot_index} (مفتاح خاطئ؟):`, e.message);
        return null;
      }
    }).filter(Boolean);
  } catch (e) {
    console.error("[APPSTATE-VAULT] ❌ فشل قراءة AppState من Postgres:", e.message);
    return [];
  }
}
/**
 * Update or set the admin Facebook ID for a specific bot.
 * Owner check is enforced: only the owner can change the admin.
 */
async function setAdminId(botIndex, owner, adminFbId) {
  if (!isEnabled() || !schemaReady) return false;
  try {
    const { rowCount } = await pool.query(
      `UPDATE appstate_vault SET admin_fb_id = $3, updated_at = now()
       WHERE bot_index = $1 AND owner = $2`,
      [botIndex, owner, adminFbId || null]
    );
    return rowCount > 0;
  } catch (e) {
    console.error('[APPSTATE-VAULT] ❌ فشل تحديث admin_fb_id:', e.message);
    return false;
  }
}

/**
 * Load admin_fb_id for all bots (no decryption needed).
 * Used at startup to hydrate api.__adminId for each bot.
 */
async function loadAllAdminIds() {
  if (!isEnabled() || !schemaReady) return new Map();
  try {
    const { rows } = await pool.query(`SELECT bot_index, admin_fb_id FROM appstate_vault`);
    const map = new Map();
    for (const r of rows) {
      if (r.admin_fb_id) map.set(r.bot_index, r.admin_fb_id);
    }
    return map;
  } catch (e) {
    console.error('[APPSTATE-VAULT] ❌ فشل جلب admin_fb_ids:', e.message);
    return new Map();
  }
}

/**
 * Returns the set of ALL bot_index values reserved in the vault (any owner).
 * Lightweight: no decryption, single column query.
 * Used by the index-allocation logic to avoid overwriting existing bots
 * on ephemeral-disk environments (e.g. Render.com) where appstate*.json
 * files disappear on restart but Postgres data persists.
 */
async function getAllIndexes() {
  if (!isEnabled() || !schemaReady) return new Set();
  try {
    const { rows } = await pool.query(`SELECT bot_index FROM appstate_vault`);
    return new Set(rows.map((r) => r.bot_index));
  } catch (e) {
    console.error("[APPSTATE-VAULT] ❌ فشل جلب قائمة الـ indexes:", e.message);
    return new Set();
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
    console.error("[APPSTATE-VAULT] ❌ فشل جلب حسابات المستخدم من Postgres:", e.message);
    return [];
  }
}
/**
 * Delete a bot row by index only — no owner check.
 * Used exclusively by the duplicate-session cleanup in loadAllAppStates()
 * where the goal is to permanently remove stale copies of the same FB account
 * regardless of who owns them.
 */
async function deleteByIndex(botIndex) {
  if (!isEnabled() || !schemaReady) return false;
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM appstate_vault WHERE bot_index = $1`,
      [botIndex]
    );
    if (rowCount > 0) {
      console.log(`[APPSTATE-VAULT] 🗑️ حُذف Bot-${botIndex} من Postgres (نسخة مكررة).`);
    }
    return rowCount > 0;
  } catch (e) {
    console.error(`[APPSTATE-VAULT] ❌ فشل حذف Bot-${botIndex} من Postgres:`, e.message);
    return false;
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
    console.error("[APPSTATE-VAULT] ❌ فشل حذف الحساب من Postgres:", e.message);
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
async function getOwner(botIndex) {
  if (!isEnabled() || !schemaReady) return null;
  try {
    const { rows } = await pool.query(`SELECT owner FROM appstate_vault WHERE bot_index = $1`, [botIndex]);
    return rows[0]?.owner || null;
  } catch { return null; }
}

export {
  init,
  isEnabled,
  saveAppState,
  updateBotName,
  updateBotFbId,
  loadAll,
  getAllIndexes,
  loadForOwner,
  deleteAppState,
  deleteByIndex,
  isOwnedBy,
  setAdminId,
  loadAllAdminIds,
  getOwner,
};
// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-db-postgres',
  meta: { category: 'db', path: 'src/db/postgres.js' },
  setup(_ctx) {
    // provides: deleteAppState, init, isEnabled, isOwnedBy, loadAll, loadForOwner, saveAppState, updateBotFbId, updateBotName
  },
};
