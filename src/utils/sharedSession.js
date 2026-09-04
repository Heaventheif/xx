"use strict";
/**
 * Shared AI session store for all chat AI commands (GPT, Gemini, Groq).
 * Replaces per-command duplicate Mongoose schema definitions.
 * Each command uses a unique collection name via the `model` parameter.
 */
import mongoose from "mongoose";
const _models = new Map();
function getSessionModel(collectionName) {
  if (_models.has(collectionName)) return _models.get(collectionName);
  const schema = new mongoose.Schema(
    {
      _id:      String,
      messages: { type: Array, default: [] },
      updatedAt: { type: Date, default: Date.now },
    },
    { collection: collectionName }
  );
  const modelName = collectionName.replace(/[^a-zA-Z0-9]/g, "_");
  const model = mongoose.models[modelName] || mongoose.model(modelName, schema);
  _models.set(collectionName, model);
  return model;
}
async function loadCtx(collectionName, id, limit = 20) {
  try {
    if (!global.db) return [];
    const Session = getSessionModel(collectionName);
    const doc = await Session.findById(String(id)).lean();
    return doc?.messages?.slice(-limit) || [];
  } catch (_) { return []; }
}
async function saveCtx(collectionName, id, messages, limit = 20) {
  try {
    if (!global.db) return;
    const Session = getSessionModel(collectionName);
    await Session.findByIdAndUpdate(
      String(id),
      { messages: messages.slice(-limit), updatedAt: new Date() },
      { upsert: true }
    );
  } catch (_) {}
}
async function clearCtx(collectionName, id) {
  try {
    if (!global.db) return;
    const Session = getSessionModel(collectionName);
    await Session.findByIdAndDelete(String(id));
  } catch (_) {}
}
export { loadCtx, saveCtx, clearCtx };
