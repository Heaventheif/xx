"use strict";
import mongoose from "mongoose";
import { UserModel, GlobalDataModel, BanModel } from "./schemas.js";
let isConnected = false;
let _syncInterval = null;
global.getUserData = getUserData;
global.markUserDirty = (uid) => {
  const d = global.usersData.get(uid);
  if (d) d._dirty = true;
};
async function getUserData(uid) {
  if (global.usersData.has(uid)) return global.usersData.get(uid);
  let data = { _lastSeen: Date.now() };
  if (global.db) {
    try {
      const doc = await UserModel.findOne({ facebookId: String(uid) }).lean();
      if (doc) data = { ...doc, _lastSeen: Date.now() };
    } catch (e) {
      console.warn("[DB] ⚠️ فشل جلب بيانات المستخدم:", e.message);
    }
  }
  global.usersData.set(uid, data);
  return data;
}
async function flushUsersData() {
  if (!global.db || global.usersData.size === 0) return;
  const ops = [];
  for (const [uid, data] of global.usersData.entries()) {
    if (!data || data._dirty !== true) continue;
    const { _lastSeen, _dirty, ...rest } = data;
    ops.push({
      updateOne: {
        filter: { facebookId: String(uid) },
        update: { $set: { ...rest, lastSeen: new Date(_lastSeen || Date.now()) } },
        upsert: true,
      },
    });
    data._dirty = false;
  }
  if (!ops.length) return;
  try {
    await UserModel.bulkWrite(ops, { ordered: false });
    console.log(`[DB] 💾 حُفظت ${ops.length} بيانات مستخدم`);
  } catch (e) {
    console.warn("[DB] ⚠️ فشل حفظ بيانات المستخدمين دفعة واحدة:", e.message);
  }
}
async function flushGlobalData() {
  if (!global.db || global.globalData.size === 0) return;
  const ops = [];
  for (const [key, value] of global.globalData.entries()) {
    ops.push({
      updateOne: { filter: { key }, update: { $set: { value } }, upsert: true },
    });
  }
  if (!ops.length) return;
  try {
    await GlobalDataModel.bulkWrite(ops, { ordered: false });
  } catch (e) {
    console.warn("[DB] ⚠️ فشل حفظ globalData:", e.message);
  }
}
async function loadGlobalData() {
  if (!global.db) return;
  try {
    const docs = await GlobalDataModel.find({}).lean();
    for (const d of docs) global.globalData.set(d.key, d.value);
    console.log(`[DB] 📥 حُمِّلت ${docs.length} مدخلة globalData`);
  } catch (e) {
    console.warn("[DB] ⚠️ فشل تحميل globalData:", e.message);
  }
}
async function loadBanList() {
  if (!global.db) return;
  try {
    const docs = await BanModel.find({}).lean();
    for (const d of docs) {
      if (d.type === "group") global._bannedGroups.add(String(d.targetID));
      else if (d.type === "user") global._bannedUsers.add(String(d.targetID));
    }
    console.log(`[DB] 📥 حُمِّلت ${docs.length} مدخلة حظر`);
  } catch (e) {
    console.warn("[DB] ⚠️ فشل تحميل قائمة الحظر:", e.message);
  }
}
async function addBanDB(type, targetID, bannedBy = null, reason = null) {
  if (!global.db) return false;
  try {
    await BanModel.updateOne(
      { type, targetID: String(targetID) },
      { $set: { type, targetID: String(targetID), bannedBy: bannedBy ? String(bannedBy) : null, reason } },
      { upsert: true }
    );
    return true;
  } catch (e) {
    console.warn("[DB] ⚠️ فشل حفظ الحظر:", e.message);
    return false;
  }
}
async function removeBanDB(type, targetID) {
  if (!global.db) return false;
  try {
    await BanModel.deleteOne({ type, targetID: String(targetID) });
    return true;
  } catch (e) {
    console.warn("[DB] ⚠️ فشل إزالة الحظر:", e.message);
    return false;
  }
}
async function connectDB() {
  const uri = process.env.MONGO_URI || global.config?.mongoUri;
  if (!uri) {
    console.warn("[DB] ⚠️ MONGO_URI غير موجود — البوت سيعمل بدون قاعدة بيانات");
    global.db = null;
    return;
  }
  if (isConnected) return;
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 8000,
      socketTimeoutMS:          45000,
      maxPoolSize:              10,
    });
    isConnected = true;
    global.db   = mongoose;
    console.log("[DB] ✅ MongoDB متصل بنجاح");
    await loadGlobalData();
    await loadBanList();
    if (_syncInterval) clearInterval(_syncInterval);
    _syncInterval = setInterval(() => {
      flushUsersData().catch(() => {});
      flushGlobalData().catch(() => {});
    }, 5 * 60 * 1000);
    mongoose.connection.on("disconnected", () => {
      isConnected = false;
      console.warn("[DB] ⚠️ انقطع الاتصال بـ MongoDB — محاولة إعادة الاتصال...");
    });
    mongoose.connection.on("reconnected", () => {
      isConnected = true;
      console.log("[DB] ✅ أعيد الاتصال بـ MongoDB");
    });
    mongoose.connection.on("error", (err) => {
      console.error("[DB] ❌ خطأ في الاتصال:", err.message);
    });
  } catch (err) {
    console.error("[DB] ❌ فشل الاتصال بـ MongoDB:", err.message);
    console.warn("[DB] البوت سيعمل بدون قاعدة بيانات");
    global.db = null;
  }
}
async function flushAllAndDisconnect() {
  await flushUsersData().catch(() => {});
  await flushGlobalData().catch(() => {});
  if (_syncInterval) clearInterval(_syncInterval);
  if (isConnected) {
    try {
      await mongoose.disconnect();
      console.log("[DB] 🔌 تم قطع اتصال MongoDB بنجاح");
    } catch (e) {
      console.warn("[DB] ⚠️ فشل قطع اتصال MongoDB:", e.message);
    } finally {
      isConnected = false;
    }
  }
}
export { connectDB, getUserData, flushUsersData, flushGlobalData, flushAllAndDisconnect, addBanDB, removeBanDB  };

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-db-index',
  meta: { category: 'db', path: 'src/db/index.js' },
  setup(_ctx) {
    // provides: addBanDB, connectDB, flushAllAndDisconnect, flushGlobalData, flushUsersData, getUserData, removeBanDB
  },
};
