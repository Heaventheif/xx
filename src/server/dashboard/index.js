"use strict";
import fs from "fs";
import path from "path";
import express from "express";
import {
  PROJECT_ROOT,
  saveAppStateForBot,
  loginBotWithAppState,
} from "../../core/Client.js";

const PUBLIC_DIR = path.join(import.meta.dir, "public");
const BOT_ADMINS_PATH = path.join(PROJECT_ROOT, "botAdmins.json");

// ─── File-based admin ID helpers ────────────────────────────────────────────
function _loadAdmins() {
  try { return JSON.parse(fs.readFileSync(BOT_ADMINS_PATH, "utf8") || "{}"); } catch { return {}; }
}
function _saveAdmins(map) {
  try { fs.writeFileSync(BOT_ADMINS_PATH, JSON.stringify(map, null, 2), "utf8"); } catch (_) {}
}
function _getAdminId(index) { return _loadAdmins()[String(index)] || null; }
function _setAdminId(index, fbId) {
  const map = _loadAdmins();
  if (fbId) map[String(index)] = fbId; else delete map[String(index)];
  _saveAdmins(map);
}
function _syncAdminsToGlobal() {
  const map = _loadAdmins();
  global._botAdminIds = global._botAdminIds || new Map();
  for (const [k, v] of Object.entries(map)) global._botAdminIds.set(Number(k), String(v));
}
_syncAdminsToGlobal();

function pickBotApi(indexParam) {
  const idx = parseInt(indexParam);
  if (Number.isFinite(idx)) {
    const found = global.botApis?.find((a) => a.__botIndex === idx);
    if (found) return found;
  }
  return global.botApi || global.botApis?.[0] || null;
}

// ─── AppState file helpers ───────────────────────────────────────────────────
function appStateSuffix(index) { return index === 1 ? "" : String(index); }
function appStateFilePath(index) {
  return path.join(PROJECT_ROOT, `appstate${appStateSuffix(index)}.json`);
}
function listAppStateFiles() {
  const files = [];
  for (let i = 1; i <= 20; i++) {
    const fp = appStateFilePath(i);
    if (fs.existsSync(fp)) files.push(i);
  }
  return files;
}

export function registerDashboard(app) {
  const router = express.Router();
  router.use(express.json({ limit: "2mb" }));

  // ─── GET /api/appstates ──────────────────────────────────────────────────
  router.get("/api/appstates", (_req, res) => {
    const fileIndexes = listAppStateFiles();
    const liveIndexes = new Set(
      (global.botApis || []).map((a) => a.__botIndex).filter(Number.isFinite)
    );
    const allIndexes = new Set([...fileIndexes, ...liveIndexes]);
    const accounts = [...allIndexes].sort((a, b) => a - b).map((index) => {
      const api   = (global.botApis || []).find((a) => a.__botIndex === index);
      const paused = global._pausedBots?.has(index) ?? false;
      return {
        index,
        name:       api?.__botName || null,
        fbId:       api?.__botFbId  || null,
        connected:  !!api,
        paused,
        adminFbId:  api?.__adminId || _getAdminId(index),
        onDisk:     fs.existsSync(appStateFilePath(index)),
      };
    });
    res.json({ accounts });
  });

  // ─── POST /api/appstates — add new AppState ──────────────────────────────
  router.post("/api/appstates", async (req, res) => {
    const { appstate, adminId } = req.body || {};
    if (!appstate) return res.status(400).json({ error: "appstate مفقود" });
    let parsed;
    try {
      parsed = typeof appstate === "string" ? JSON.parse(appstate) : appstate;
      if (!Array.isArray(parsed)) throw new Error("ليس مصفوفة");
    } catch {
      return res.status(400).json({ error: "AppState غير صالح — يجب أن يكون JSON على شكل مصفوفة كوكيز" });
    }
    // اختيار index حر
    const liveIndexes = new Set(
      (global.botApis || []).map((a) => a.__botIndex).filter(Number.isFinite)
    );
    let index = 1;
    while (liveIndexes.has(index) || fs.existsSync(appStateFilePath(index))) index++;
    if (index > 20) return res.status(400).json({ error: "تم بلوغ الحد الأقصى (20 حساباً)" });

    // تنظيف أي بوت قديم على نفس الـ index إن وُجد
    const existing = (global.botApis || []).find((a) => a.__botIndex === index);
    if (existing) {
      try { existing.__stopWatchdog?.(); } catch (_) {}
      try { existing.__stopSweep?.();   } catch (_) {}
      try { existing.__sessionLock?.release?.(); } catch (_) {}
      global.botApis = global.botApis.filter((a) => a.__botIndex !== index);
      if (global.botApi?.__botIndex === index) global.botApi = global.botApis[0] || null;
    }

    saveAppStateForBot(parsed, index);

    // حفظ admin ID
    if (adminId) {
      _setAdminId(index, String(adminId).trim());
      _syncAdminsToGlobal();
    }

    const filePath = appStateFilePath(index);
    let loginError = null;
    await new Promise((resolve) => {
      loginBotWithAppState(
        { state: parsed, filePath, index, source: `appstate${appStateSuffix(index)}.json (dashboard)` },
        (errMsg) => { loginError = errMsg; resolve(); },
        null
      );
      setTimeout(resolve, 8000);
    });
    if (loginError) return res.status(502).json({ error: `فشل تسجيل الدخول: ${loginError}`, ok: false });
    res.json({ ok: true, index, connectedNow: true });
  });

  // ─── DELETE /api/appstates/:index ────────────────────────────────────────
  router.delete("/api/appstates/:index", (req, res) => {
    const index = parseInt(req.params.index, 10);
    if (!Number.isFinite(index) || index < 1 || index > 20)
      return res.status(400).json({ error: "index غير صالح" });

    const fp = appStateFilePath(index);
    try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (_) {}

    const dead = (global.botApis || []).find((a) => a.__botIndex === index);
    if (dead) {
      try { dead.__stopWatchdog?.(); } catch (_) {}
      try { dead.__stopSweep?.();   } catch (_) {}
      try { dead.__sessionLock?.release?.(); } catch (_) {}
      global.botApis = global.botApis.filter((a) => a.__botIndex !== index);
      if (global.botApi?.__botIndex === index) global.botApi = global.botApis[0] || null;
      console.log(`[DASHBOARD] 🗑️ Bot-${index} أُزيل من الذاكرة.`);
    }
    _setAdminId(index, null);
    res.json({ ok: true });
  });

  // ─── PATCH /api/appstates/:index/admin ───────────────────────────────────
  router.patch("/api/appstates/:index/admin", (req, res) => {
    const index   = parseInt(req.params.index, 10);
    const adminId = req.body?.adminId != null ? String(req.body.adminId).trim() : null;
    if (!Number.isFinite(index) || index < 1 || index > 20)
      return res.status(400).json({ error: "index غير صالح" });
    _setAdminId(index, adminId || null);
    _syncAdminsToGlobal();
    const api = (global.botApis || []).find((a) => a.__botIndex === index);
    if (api) api.__adminId = adminId;
    res.json({ ok: true, adminId });
  });

  // ─── POST /api/appstates/:index/pause ────────────────────────────────────
  router.post("/api/appstates/:index/pause", (req, res) => {
    const index = parseInt(req.params.index, 10);
    if (!Number.isFinite(index) || index < 1 || index > 20)
      return res.status(400).json({ error: "index غير صالح" });
    global._pausedBots = global._pausedBots || new Set();
    global._pausedBots.add(index);
    const api = (global.botApis || []).find((a) => a.__botIndex === index);
    api?.__stopWatchdog?.();
    res.json({ ok: true, paused: true });
  });

  // ─── POST /api/appstates/:index/resume ───────────────────────────────────
  router.post("/api/appstates/:index/resume", (req, res) => {
    const index = parseInt(req.params.index, 10);
    if (!Number.isFinite(index) || index < 1 || index > 20)
      return res.status(400).json({ error: "index غير صالح" });
    global._pausedBots = global._pausedBots || new Set();
    global._pausedBots.delete(index);
    const api = (global.botApis || []).find((a) => a.__botIndex === index);
    api?.__restartWatchdog?.();
    res.json({ ok: true, paused: false });
  });

  // ─── GET /api/stats (minimal) ────────────────────────────────────────────
  router.get("/api/stats", (_req, res) => {
    res.json({
      uptimeSeconds: Math.floor(process.uptime()),
      bots: {
        connected: (global.botApis || []).length,
        indexes:   (global.botApis || []).map((a) => a.__botIndex).filter(Number.isFinite),
        paused:    [...(global._pausedBots || [])],
      },
    });
  });

  // ─── Static + router ─────────────────────────────────────────────────────
  app.use("/dashboard", router);
  app.use("/dashboard", express.static(PUBLIC_DIR));
  console.log("[DASHBOARD] ✅ لوحة التحكم متاحة على /dashboard (بلا تسجيل دخول)");
}

export const $plugin = {
  name: "xx-server-dashboard-index",
  meta: { category: "server-dashboard", path: "src/server/dashboard/index.js" },
  setup(_ctx) {},
};
