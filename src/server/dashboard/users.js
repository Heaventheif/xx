"use strict";
import fs from "fs-extra";
import path from "path";
import crypto from "crypto";
import { DashboardUserModel } from "../../db/schemas.js";
let _usersFilePath = null;
let _cache = null; 
function init(projectRoot) {
  _usersFilePath = path.join(projectRoot, "dashboardUsers.json");
  _cache = new Map();
  try {
    if (fs.existsSync(_usersFilePath)) {
      const raw = JSON.parse(fs.readFileSync(_usersFilePath, "utf8"));
      for (const u of Array.isArray(raw) ? raw : []) {
        if (u?.username) _cache.set(String(u.username).toLowerCase(), u);
      }
    }
  } catch (e) {
    console.warn("[DASHBOARD-USERS] ⚠️ تعذّرت قراءة dashboardUsers.json:", e.message);
  }
}
function persist() {
  if (!_usersFilePath) return;
  const tmpPath = _usersFilePath + ".tmp";
  try {
    fs.writeFileSync(tmpPath, JSON.stringify([..._cache.values()], null, 2), "utf8");
    try { fs.chmodSync(tmpPath, 0o600); } catch (_) {}
    fs.renameSync(tmpPath, _usersFilePath);
  } catch (e) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
    console.error("[DASHBOARD-USERS] ❌ فشل حفظ dashboardUsers.json:", e.message);
  }
}
function usingMongo() {
  return !!global.db;
}
// يهرب الأحرف الخاصة بالـ RegExp حتى لا يتحول اسم المستخدم (مثل "ali.x") إلى
// نمط بحث يطابق أسماء أخرى («.» تطابق أي حرف) — ثغرة حقن Regex بسيطة.
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function scryptHash(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString("hex");
}
function validateCredentials(username, password) {
  const name = String(username || "").trim();
  const pass = String(password || "");
  if (!/^[a-zA-Z0-9_\-.]{3,32}$/.test(name)) {
    return "اسم المستخدم يجب أن يكون 3-32 حرفاً (أحرف/أرقام/_ - . فقط)";
  }
  if (pass.length < 6) {
    return "كلمة المرور يجب أن تكون 6 أحرف على الأقل";
  }
  return null;
}
async function userExists(username) {
  const name = String(username || "").toLowerCase();
  if (usingMongo()) {
    try {
      return !!(await DashboardUserModel.exists({ username: new RegExp(`^${escapeRegex(name)}$`, "i") }));
    } catch {
      return _cache.has(name); 
    }
  }
  return _cache.has(name);
}
function userCount() {
  return usingMongo() ? null : _cache.size; 
}
async function createUser(username, password) {
  const name = String(username || "").trim();
  const err = validateCredentials(name, password);
  if (err) return { ok: false, error: err };
  if (await userExists(name)) {
    return { ok: false, error: "اسم المستخدم مستخدم بالفعل" };
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = scryptHash(password, salt);
  if (usingMongo()) {
    try {
      await DashboardUserModel.create({ username: name, salt, hash });
      return { ok: true };
    } catch (e) {
      if (e?.code === 11000) return { ok: false, error: "اسم المستخدم مستخدم بالفعل" };
      console.error("[DASHBOARD-USERS] ❌ فشل إنشاء الحساب في MongoDB:", e.message);
      return { ok: false, error: "تعذّر إنشاء الحساب حالياً — حاول مرة أخرى" };
    }
  }
  const record = { username: name, salt, hash, createdAt: Date.now() };
  _cache.set(name.toLowerCase(), record);
  persist();
  return { ok: true };
}
async function verifyUser(username, password) {
  let record = null;
  if (usingMongo()) {
    try {
      record = await DashboardUserModel.findOne({
        username: new RegExp(`^${escapeRegex(String(username || "").toLowerCase())}$`, "i"),
      }).lean();
    } catch (e) {
      console.error("[DASHBOARD-USERS] ❌ فشل الاستعلام من MongoDB:", e.message);
    }
  } else {
    record = _cache.get(String(username || "").toLowerCase()) || null;
  }
  if (!record) return { ok: false, error: "بيانات الدخول غير صحيحة" };
  const candidateHash = scryptHash(password, record.salt);
  const a = Buffer.from(candidateHash, "hex");
  const b = Buffer.from(record.hash, "hex");
  const matches = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!matches) return { ok: false, error: "بيانات الدخول غير صحيحة" };
  return { ok: true, username: record.username };
}
export { init, userExists, userCount, createUser, verifyUser };
