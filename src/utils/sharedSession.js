"use strict";
/**
 * sharedSession.js
 * ────────────────
 * تخزين جلسات AI (GPT / Gemini / Groq) في MongoDB عبر MONGO_URI.
 * عند غياب MONGO_URI → يستخدم الذاكرة (Map) تلقائياً.
 */

// ── اتصال MongoDB (مُشترك بين جميع الأوامر) ─────────────────────────────────
let _mongoose   = null;
let _connected  = false;
let _connecting = false;

async function getMongoose() {
  if (_connected) return _mongoose;
  if (_connecting) {
    // انتظر حتى ينتهي الاتصال الجاري
    await new Promise(r => setTimeout(r, 1500));
    return _connected ? _mongoose : null;
  }

  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || "";
  if (!uri) return null;

  try {
    _connecting = true;
    const mod   = await import("mongoose");
    _mongoose   = mod.default ?? mod;

    if (_mongoose.connection.readyState === 0) {
      await _mongoose.connect(uri, {
        dbName:             "sunkenbot",
        serverSelectionTimeoutMS: 8000,
        socketTimeoutMS:          30000,
      });
    }

    _connected  = true;
    _connecting = false;
    console.log("[SESSION] ✅ MongoDB متصل (جلسات AI)");
    return _mongoose;
  } catch (e) {
    _connecting = false;
    console.warn("[SESSION] ⚠️ MongoDB غير متاح — سيُستخدم RAM:", e.message);
    return null;
  }
}

// ── نماذج Mongoose (cached) ───────────────────────────────────────────────────
const _models = new Map();

function getModel(mg, collectionName) {
  if (_models.has(collectionName)) return _models.get(collectionName);
  const schema = new mg.Schema(
    {
      _id:       String,
      messages:  { type: Array, default: [] },
      updatedAt: { type: Date,  default: Date.now },
    },
    { collection: collectionName }
  );
  const name  = collectionName.replace(/[^a-zA-Z0-9]/g, "_");
  const model = mg.models[name] ?? mg.model(name, schema);
  _models.set(collectionName, model);
  return model;
}

// ── RAM fallback ──────────────────────────────────────────────────────────────
const _ram = new Map(); // key: `${collection}::${id}`

function ramKey(col, id) { return `${col}::${id}`; }

// ── API ───────────────────────────────────────────────────────────────────────

export async function loadCtx(collectionName, id, limit = 20) {
  try {
    const mg = await getMongoose();
    if (mg) {
      const doc = await getModel(mg, collectionName).findById(String(id)).lean();
      return doc?.messages?.slice(-limit) || [];
    }
    // RAM fallback
    return (_ram.get(ramKey(collectionName, id)) || []).slice(-limit);
  } catch (_) {
    return (_ram.get(ramKey(collectionName, id)) || []).slice(-limit);
  }
}

export async function saveCtx(collectionName, id, messages, limit = 20) {
  const sliced = messages.slice(-limit);
  try {
    const mg = await getMongoose();
    if (mg) {
      await getModel(mg, collectionName).findByIdAndUpdate(
        String(id),
        { messages: sliced, updatedAt: new Date() },
        { upsert: true }
      );
      return;
    }
  } catch (_) {}
  // RAM fallback
  _ram.set(ramKey(collectionName, id), sliced);
}

export async function clearCtx(collectionName, id) {
  try {
    const mg = await getMongoose();
    if (mg) {
      await getModel(mg, collectionName).findByIdAndDelete(String(id));
      return;
    }
  } catch (_) {}
  _ram.delete(ramKey(collectionName, id));
}

// ── Plugin Descriptor ─────────────────────────────────────────────────────────
export const $plugin = {
  name:  "xx-utils-shared-session",
  meta:  { category: "utils", path: "src/utils/sharedSession.js" },
  setup: (_ctx) => {},
};
