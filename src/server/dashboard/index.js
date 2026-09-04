"use strict";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import express from "express";
import chalk from "chalk";
import { isValidFbId } from "../../utils/validate.js";
import { addBanDB, removeBanDB } from "../../db/index.js";
import {
  PROJECT_ROOT,
  saveAppStateForBot,
  loginBotWithAppState,
  loadBotNames,
} from "../../core/Client.js";
import * as appStateVault from "../../db/postgres.js";
import * as dashboardUsers from "./users.js";
import {
  recordStoryEvent,
  getStoryEvents,
  getFriendEvents,
  clearStoryEvents,
} from "./facebook-store.js";

dashboardUsers.init(PROJECT_ROOT);

const PUBLIC_DIR = path.join(import.meta.dir, "public");
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const sessions = new Map();

function makeSessionId() {
  return crypto.randomBytes(32).toString("hex");
}
function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}
function isRequestSecure(req) {
  return req.secure || req.headers["x-forwarded-proto"] === "https";
}
function setSidCookie(req, res, sid, maxAgeMs) {
  const attrs = [
    `sid=${encodeURIComponent(sid)}`,
    "Path=/dashboard",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (isRequestSecure(req)) attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}
function clearSidCookie(req, res) {
  const attrs = [
    "sid=",
    "Path=/dashboard",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (isRequestSecure(req)) attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}
function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [sid, s] of sessions.entries()) {
    if (s.expiresAt <= now) sessions.delete(sid);
  }
}
setInterval(cleanupExpiredSessions, 30 * 60 * 1000);

const CACHE_TTL_MS = 60 * 1000;
let _groupsCache = { at: 0, botIndex: null, data: [] };

// Friends list cache (per bot)
const _friendsCache = new Map(); // botIndex -> { at, data }

function pickBotApi(indexParam) {
  const idx = parseInt(indexParam);
  if (Number.isFinite(idx)) {
    const found = global.botApis.find((a) => a.__botIndex === idx);
    if (found) return found;
  }
  return global.botApi || global.botApis[0] || null;
}

async function fetchGroups(api, { force = false, botIndex = 1 } = {}) {
  const now = Date.now();
  if (!force && _groupsCache.botIndex === botIndex && now - _groupsCache.at < CACHE_TTL_MS) {
    return _groupsCache.data;
  }
  if (!api || typeof api.getThreadList !== "function") return [];
  const collected = [];
  let cursor = null;
  for (let page = 0; page < 5; page++) {
    let batch;
    try {
      batch = await api.getThreadList(100, cursor, []);
    } catch {
      break;
    }
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const t of batch) {
      if (t.isGroup === true || t.threadType === "GROUP") {
        collected.push({
          threadID: String(t.threadID),
          name: t.name || t.threadName || "[بدون اسم]",
          memberCount: t.participantIDs?.length ?? t.participants?.length ?? null,
        });
      }
    }
    if (batch.length < 100) break;
    cursor = batch[batch.length - 1]?.timestamp || null;
    if (!cursor) break;
  }
  _groupsCache = { at: now, botIndex, data: collected };
  return collected;
}

async function fetchPendingRequests(api) {
  const tags = ["PENDING", "OTHER", "SPAM", "UNKNOWN"];
  const seen = new Set();
  const combined = [];
  for (const tag of tags) {
    try {
      const list = await api.getThreadList(50, null, [tag]);
      if (!Array.isArray(list)) continue;
      for (const t of list) {
        const id = String(t.threadID ?? "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const isGroup = t.isGroup === true || t.threadType === "GROUP";
        let name = t.name || t.threadName || null;
        if (!name) {
          const ids = t.participantIDs || [];
          const botId = String(global.botApi?.getCurrentUserID?.() || "");
          name = isGroup
            ? "[مجموعة بدون اسم]"
            : `UID: ${ids.find((p) => String(p) !== botId) || ids[0] || "?"}`;
        }
        combined.push({
          threadID: id,
          isGroup,
          name,
          folder: tag,
          preview: t.lastMessageData?.body ? String(t.lastMessageData.body).slice(0, 120) : "",
        });
      }
    } catch {
    }
  }
  return combined;
}

/**
 * Fetch friends list with optional caching
 * @param {object} api - FCA API
 * @param {number} botIndex
 * @param {boolean} force - bypass cache
 */
async function fetchFriendsList(api, { botIndex = 1, force = false } = {}) {
  const now = Date.now();
  const cached = _friendsCache.get(botIndex);
  // Cache friends list for 5 minutes
  if (!force && cached && now - cached.at < 5 * 60 * 1000) {
    return cached.data;
  }
  if (typeof api.getFriendsList !== "function") return [];
  const friends = await new Promise((resolve, reject) => {
    api.getFriendsList((err, list) => (err ? reject(err) : resolve(list || [])));
  });
  _friendsCache.set(botIndex, { at: now, data: friends });
  return friends;
}

/**
 * Lookup user info by UID
 * @param {object} api
 * @param {string} uid
 */
// ─── Facebook API Helpers ────────────────────────────────────────────────────

/**
 * POST to a Facebook endpoint using the FCA cookie jar (bypasses CORS).
 * callback receives (err, parsedBody)
 */
function _fbRawPost(api, url, form) {
  const ctx = api?._ctx;
  const df  = api?._defaultFuncs;
  if (!ctx || !df) return Promise.reject(new Error("FCA context غير متاح — أعد تشغيل البوت"));
  const uid = String(ctx.userID || ctx.fbid || "");
  return new Promise((resolve, reject) => {
    df.post(url, ctx.jar, { __user: uid, __a: "1", ...form }, (err, body) => {
      if (err) return reject(err);
      // Strip for(;;); CSRF prefix Facebook sometimes prepends
      let data = body;
      if (typeof body === "string") {
        try { data = JSON.parse(body.replace(/^for\s*\(;;\);/, "").trim()); } catch { data = body; }
      }
      if (data?.error) {
        return reject(new Error(data.error?.message || JSON.stringify(data.error).slice(0, 200)));
      }
      resolve(data);
    });
  });
}

/**
 * Create a timeline post.
 * 1. Tries api.createPost natively (may exist via attachNexusMethods).
 * 2. If native throws "utils is not defined" (known fca-unofficial bug), falls back to GraphQL.
 */
async function _safeCreatePost(api, body, privacy) {
  if (typeof api.createPost === "function") {
    try {
      return await new Promise((resolve, reject) => {
        api.createPost({ body, privacy }, (err, r) => (err ? reject(err) : resolve(r)));
      });
    } catch (e) {
      // Catch the "utils is not defined" ReferenceError from broken fca implementations
      if (!/not defined|utils/i.test(e.message)) throw e;
      console.warn("[DASHBOARD] createPost: utils bug — falling back to GraphQL:", e.message);
    }
  }
  // GraphQL fallback — works as long as the session cookies are valid
  const ctx = api?._ctx;
  if (!ctx) throw new Error("createPost: FCA context غير متاح");
  const uid = String(ctx.userID || ctx.fbid || "");
  return _fbRawPost(api, "https://www.facebook.com/api/graphql/", {
    fb_api_req_friendly_name: "CometComposerStoryCreateMutation",
    fb_api_caller_class:      "RelayModern",
    server_timestamps:        "true",
    variables: JSON.stringify({
      input: {
        composer_type:        "timeline",
        message:              { ranges: [], text: body },
        audience:             { value: privacy },
        actor_id:             uid,
        client_mutation_id:   Math.random().toString(36).slice(2),
        session_id:           Math.random().toString(36).slice(2),
      },
      feedLocation:   "TIMELINE",
      feedbackSource: 1,
      scale:          1,
    }),
  });
}

// ─────────────────────────────────────────────────────────────────────────────

async function lookupUserInfo(api, uid) {
  return new Promise((resolve, reject) => {
    api.getUserInfo(uid, (err, res) => (err ? reject(err) : resolve(res)));
  });
}

function registerDashboard(app) {
  const router = express.Router();
  router.use(express.json({ limit: "2mb" }));

  function requireAuth(req, res, next) {
    const cookies = parseCookies(req);
    const sid = cookies.sid;
    const session = sid ? sessions.get(sid) : null;
    if (!session || session.expiresAt <= Date.now()) {
      return res.status(401).json({ error: "unauthorized" });
    }
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    req.dashboardUser = session.username;
    next();
  }

  // ───── Auth ─────
  router.post("/api/register", async (req, res) => {
    const { username, password } = req.body || {};
    const result = await dashboardUsers.createUser(username, password);
    if (!result.ok) return res.status(400).json({ error: result.error });
    const sid = makeSessionId();
    sessions.set(sid, { username: String(username).trim(), expiresAt: Date.now() + SESSION_TTL_MS });
    setSidCookie(req, res, sid, SESSION_TTL_MS);
    res.json({ ok: true });
  });

  router.post("/api/login", async (req, res) => {
    const { username, password } = req.body || {};
    const result = await dashboardUsers.verifyUser(username, password);
    if (!result.ok) return res.status(401).json({ error: result.error });
    const sid = makeSessionId();
    sessions.set(sid, { username: result.username, expiresAt: Date.now() + SESSION_TTL_MS });
    setSidCookie(req, res, sid, SESSION_TTL_MS);
    res.json({ ok: true });
  });

  router.post("/api/logout", (req, res) => {
    const cookies = parseCookies(req);
    if (cookies.sid) sessions.delete(cookies.sid);
    clearSidCookie(req, res);
    res.json({ ok: true });
  });

  router.get("/api/me", requireAuth, (req, res) => res.json({ ok: true, username: req.dashboardUser }));

  // ───── Stats ─────
  router.get("/api/stats", requireAuth, (_req, res) => {
    const mem = process.memoryUsage();
    res.json({
      uptimeSeconds: Math.floor(process.uptime()),
      bots: {
        connected: global.botApis.length,
        indexes: global.botApis.map((a) => a.__botIndex).filter((n) => Number.isFinite(n)),
      },
      commandsLoaded: global.commands?.size || 0,
      db: { connected: !!global.db },
      users: { inMemory: global.usersData?.size || 0 },
      bans: {
        groups: global._bannedGroups?.size || 0,
        users: global._bannedUsers?.size || 0,
      },
      memory: {
        rssMB: +(mem.rss / 1024 / 1024).toFixed(1),
        heapUsedMB: +(mem.heapUsed / 1024 / 1024).toFixed(1),
        heapTotalMB: +(mem.heapTotal / 1024 / 1024).toFixed(1),
        systemFreeMB: +(os.freemem() / 1024 / 1024).toFixed(1),
        systemTotalMB: +(os.totalmem() / 1024 / 1024).toFixed(1),
      },
      groupsCached: _groupsCache.data.length,
      groupsCacheAgeSeconds: _groupsCache.at ? Math.floor((Date.now() - _groupsCache.at) / 1000) : null,
    });
  });

  // ───── Groups ─────
  router.get("/api/groups", requireAuth, async (req, res) => {
    const botIndex = parseInt(req.query.bot) || 1;
    const api = pickBotApi(botIndex);
    if (!api) return res.status(503).json({ error: "لا يوجد بوت متصل حالياً" });
    try {
      const force = req.query.refresh === "1";
      const groups = await fetchGroups(api, { force, botIndex });
      const q = (req.query.q || "").toString().trim().toLowerCase();
      const filtered = q
        ? groups.filter((g) => g.name.toLowerCase().includes(q) || g.threadID.includes(q))
        : groups;
      res.json({ groups: filtered, total: groups.length, cachedAt: _groupsCache.at });
    } catch (e) {
      res.status(500).json({ error: e.message?.slice(0, 300) || "خطأ غير معروف" });
    }
  });

  router.post("/api/groups/:gid/leave", requireAuth, async (req, res) => {
    const { gid } = req.params;
    const botIndex = parseInt(req.query.bot) || 1;
    const api = pickBotApi(botIndex);
    if (!api) return res.status(503).json({ error: "لا يوجد بوت متصل حالياً" });
    try {
      const botID = api.getCurrentUserID?.();
      if (typeof api.removeUserFromGroup === "function" && botID) {
        await api.removeUserFromGroup(botID, gid);
      } else if (typeof api.deleteThread === "function") {
        await api.deleteThread(gid);
      } else {
        return res.status(501).json({ error: "لا توجد دالة مغادرة مدعومة في هذه النسخة من fca-unofficial" });
      }
      _groupsCache.data = _groupsCache.data.filter((g) => g.threadID !== String(gid));
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message?.slice(0, 300) || "فشل مغادرة المجموعة" });
    }
  });

  // ───── Message Requests ─────
  router.get("/api/requests", requireAuth, async (req, res) => {
    const botIndex = parseInt(req.query.bot) || 1;
    const api = pickBotApi(botIndex);
    if (!api) return res.status(503).json({ error: "لا يوجد بوت متصل حالياً" });
    try {
      const requests = await fetchPendingRequests(api);
      res.json({ requests });
    } catch (e) {
      res.status(500).json({ error: e.message?.slice(0, 300) || "فشل جلب الطلبات" });
    }
  });

  router.post("/api/requests/:tid/accept", requireAuth, async (req, res) => {
    await handleRequestDecision(req, res, true);
  });
  router.post("/api/requests/:tid/reject", requireAuth, async (req, res) => {
    await handleRequestDecision(req, res, false);
  });

  async function handleRequestDecision(req, res, accept) {
    const { tid } = req.params;
    const botIndex = parseInt(req.query.bot) || 1;
    const api = pickBotApi(botIndex);
    if (!api) return res.status(503).json({ error: "لا يوجد بوت متصل حالياً" });
    try {
      await api.handleMessageRequest(tid, accept);
      res.json({ ok: true });
    } catch (e) {
      const code = e?.error ?? e?.error_code;
      if (code === 1357031) {
        return res.status(409).json({
          error: "فيسبوك رافض الإجراء لأن المحتوى لم يعد موجوداً من ناحيته — الطلب عالق بشكل دائم.",
        });
      }
      res.status(500).json({ error: e.message?.slice(0, 300) || "فشلت العملية" });
    }
  }

  // ───── Broadcast ─────
  router.post("/api/broadcast", requireAuth, async (req, res) => {
    const { threadIDs, message } = req.body || {};
    const botIndex = parseInt(req.query.bot) || 1;
    const api = pickBotApi(botIndex);
    if (!api) return res.status(503).json({ error: "لا يوجد بوت متصل حالياً" });
    if (!Array.isArray(threadIDs) || !threadIDs.length) {
      return res.status(400).json({ error: "حدد مجموعة واحدة على الأقل" });
    }
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: "الرسالة فارغة" });
    }
    const results = [];
    for (const tid of threadIDs) {
      try {
        await new Promise((resolve, reject) => {
          global.safeSend(api, String(message), String(tid), (err) => (err ? reject(err) : resolve()));
        });
        results.push({ threadID: tid, ok: true });
      } catch (e) {
        results.push({ threadID: tid, ok: false, error: e.message?.slice(0, 150) });
      }
      await new Promise((r) => setTimeout(r, 350));
    }
    res.json({ results });
  });

  // ───── Bans ─────
  router.get("/api/bans", requireAuth, (_req, res) => {
    res.json({
      groups: [...(global._bannedGroups || [])],
      users: [...(global._bannedUsers || [])],
      dbConnected: !!global.db,
    });
  });

  router.post("/api/bans", requireAuth, async (req, res) => {
    const { type, targetID, reason } = req.body || {};
    if (type !== "group" && type !== "user") {
      return res.status(400).json({ error: "type يجب أن يكون group أو user" });
    }
    const id = String(targetID || "").trim();
    if (!isValidFbId(id)) {
      return res.status(400).json({ error: "معرّف فيسبوك غير صالح" });
    }
    if (!global.db) {
      return res.status(503).json({ error: "لا يوجد اتصال بقاعدة البيانات — لا يمكن حفظ الحظر بشكل دائم الآن" });
    }
    const ok = await addBanDB(type, id, req.dashboardUser || "dashboard", reason || null);
    if (!ok) return res.status(500).json({ error: "فشل حفظ الحظر" });
    (type === "group" ? global._bannedGroups : global._bannedUsers).add(id);
    res.json({ ok: true });
  });

  router.delete("/api/bans", requireAuth, async (req, res) => {
    const { type, targetID } = req.body || {};
    if (type !== "group" && type !== "user") {
      return res.status(400).json({ error: "type يجب أن يكون group أو user" });
    }
    const id = String(targetID || "").trim();
    if (!global.db) {
      return res.status(503).json({ error: "لا يوجد اتصال بقاعدة البيانات — لا يمكن رفع الحظر بشكل دائم الآن" });
    }
    const ok = await removeBanDB(type, id);
    if (!ok) return res.status(500).json({ error: "فشل رفع الحظر" });
    (type === "group" ? global._bannedGroups : global._bannedUsers).delete(id);
    res.json({ ok: true });
  });

  // ───── AppStates ─────
  router.get("/api/appstates", requireAuth, async (req, res) => {
    const connectedIndexes = new Set(
      global.botApis.map((a) => a.__botIndex).filter((n) => Number.isFinite(n))
    );
    const names = loadBotNames();
    let visibleIndexes;
    if (appStateVault.isEnabled()) {
      const owned = await appStateVault.loadForOwner(req.dashboardUser);
      visibleIndexes = new Set(owned.map((o) => o.index));
    } else {
      visibleIndexes = null;
    }
    const accounts = [];
    for (let i = 1; i <= 20; i++) {
      const suffix = i === 1 ? "" : String(i);
      const onDisk = fs.existsSync(path.join(PROJECT_ROOT, `appstate${suffix}.json`));
      if (!onDisk && !connectedIndexes.has(i)) continue;
      if (visibleIndexes && !visibleIndexes.has(i)) continue;
      const liveApi = global.botApis.find((a) => a.__botIndex === i);
      accounts.push({
        index: i,
        connected: connectedIndexes.has(i),
        name: liveApi?.__botName || names[String(i)] || null,
      });
    }
    let nextFreeIndex = 1;
    while (
      connectedIndexes.has(nextFreeIndex) ||
      fs.existsSync(path.join(PROJECT_ROOT, `appstate${nextFreeIndex === 1 ? "" : nextFreeIndex}.json`))
    ) nextFreeIndex++;
    res.json({ accounts, nextFreeIndex, isolated: appStateVault.isEnabled() });
  });

  router.post("/api/appstates", requireAuth, async (req, res) => {
    const { appstate } = req.body || {};
    const connectedIndexes = new Set(
      global.botApis.map((a) => a.__botIndex).filter((n) => Number.isFinite(n))
    );
    let index = 1;
    while (
      connectedIndexes.has(index) ||
      fs.existsSync(path.join(PROJECT_ROOT, `appstate${index === 1 ? "" : index}.json`))
    ) index++;
    if (index > 20) {
      return res.status(400).json({ error: "تم بلوغ الحد الأقصى لعدد الحسابات (20)" });
    }
    let parsed;
    try {
      parsed = typeof appstate === "string" ? JSON.parse(appstate) : appstate;
      if (!Array.isArray(parsed)) throw new Error("not an array");
    } catch {
      return res.status(400).json({ error: "AppState غير صالح — يجب أن يكون JSON على شكل مصفوفة كوكيز" });
    }
    saveAppStateForBot(parsed, index);
    if (appStateVault.isEnabled()) {
      await appStateVault.saveAppState(index, req.dashboardUser, parsed);
    }
    const suffix = index === 1 ? "" : String(index);
    const filePath = path.join(PROJECT_ROOT, `appstate${suffix}.json`);
    let loginError = null;
    await new Promise((resolve) => {
      loginBotWithAppState(
        { state: parsed, filePath, index, source: `appstate${suffix}.json (dashboard)` },
        (errMsg) => { loginError = errMsg; resolve(); },
        null
      );
      setTimeout(resolve, 8000);
    });
    if (loginError) {
      return res.status(502).json({ error: `فشل تسجيل الدخول: ${loginError}`, ok: false });
    }
    res.json({ ok: true, connectedNow: true });
  });

  router.delete("/api/appstates/:index", requireAuth, async (req, res) => {
    const index = parseInt(req.params.index, 10);
    if (!Number.isFinite(index) || index < 1 || index > 20) {
      return res.status(400).json({ error: "index غير صالح" });
    }
    if (appStateVault.isEnabled()) {
      const owned = await appStateVault.isOwnedBy(index, req.dashboardUser);
      if (owned === false) {
        return res.status(403).json({ error: "هذا الحساب لا يخص هذا المستخدم" });
      }
      await appStateVault.deleteAppState(index, req.dashboardUser);
    }
    const suffix = index === 1 ? "" : String(index);
    const filePath = path.join(PROJECT_ROOT, `appstate${suffix}.json`);
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
    res.json({
      ok: true,
      note: "تم حذف ملف الجلسة. إن كان الحساب متصلاً حالياً، أعد تشغيل الخدمة لإيقافه فعلياً.",
    });
  });

  // ───── Commands ─────
  router.get("/api/commands", requireAuth, (_req, res) => {
    const seen = new Map();
    for (const cmd of global.commands.values()) {
      const cfg = cmd?.config;
      if (!cfg?.name) continue;
      if (!seen.has(cfg.name)) seen.set(cfg.name, cmd);
    }
    const list = [...seen.values()].map(cmd => ({
      name:     cmd.config.name,
      category: cmd.config.category || "أخرى",
      enabled:  cmd.config.enabled !== false,
      hidden:   !!cmd.config.hidden,
    })).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    res.json({ ok: true, commands: list });
  });

  router.patch("/api/commands/:name", requireAuth, (req, res) => {
    const name = req.params.name.toLowerCase();
    const { enabled, hidden } = req.body || {};
    if (typeof enabled !== "boolean" && typeof hidden !== "boolean") {
      return res.status(400).json({ error: "يجب إرسال enabled أو hidden (boolean)" });
    }
    const seen = new Map();
    for (const cmd of global.commands.values()) {
      const cfg = cmd?.config;
      if (!cfg?.name) continue;
      if (!seen.has(cfg.name)) seen.set(cfg.name, cmd);
    }
    const cmd = seen.get(name);
    if (!cmd) return res.status(404).json({ error: "الأمر غير موجود" });
    if (typeof enabled === "boolean") cmd.config.enabled = enabled;
    if (typeof hidden  === "boolean") cmd.config.hidden  = hidden;
    const allAliases = [name, ...(cmd.config.aliases || []).map(a => String(a).toLowerCase())];
    for (const alias of allAliases) {
      const aliasCmd = global.commands.get(alias);
      if (aliasCmd && aliasCmd.config?.name?.toLowerCase() === name) {
        if (typeof enabled === "boolean") aliasCmd.config.enabled = enabled;
        if (typeof hidden  === "boolean") aliasCmd.config.hidden  = hidden;
      }
    }
    const overridesPath = global.cmdOverridesPath || path.join(PROJECT_ROOT, "cmd-overrides.json");
    let overrides = {};
    try { if (fs.existsSync(overridesPath)) overrides = JSON.parse(fs.readFileSync(overridesPath, "utf8")); } catch (_) {}
    if (!overrides[name]) overrides[name] = {};
    if (typeof enabled === "boolean") overrides[name].enabled = enabled;
    if (typeof hidden  === "boolean") overrides[name].hidden  = hidden;
    try {
      fs.writeFileSync(overridesPath, JSON.stringify(overrides, null, 2), "utf8");
    } catch (e) {
      return res.status(500).json({ error: "فشل حفظ الإعدادات: " + e.message });
    }
    res.json({ ok: true, name, enabled: cmd.config.enabled !== false, hidden: !!cmd.config.hidden });
  });

  // ═══════════════════════════════════════════════════════════════
  //  📘 FACEBOOK ACCOUNT CONTROL ROUTES
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /api/facebook/profile
   * Returns current bot account profile info
   */
  router.get("/api/facebook/profile", requireAuth, async (req, res) => {
    const botIndex = parseInt(req.query.bot) || 1;
    const api = pickBotApi(botIndex);
    if (!api) return res.status(503).json({ error: "لا يوجد بوت متصل حالياً" });
    try {
      const uid = api.getCurrentUserID?.();
      if (!uid) return res.status(503).json({ error: "تعذّر جلب معرّف الحساب" });
      const info = await lookupUserInfo(api, uid);
      const raw  = info?.[uid] || {};
      // [FIX] Normalise name: fca-unofficial uses different field names across versions
      const profile = {
        ...raw,
        name: raw.name || raw.fullName || raw.firstName || api.__botName || null,
      };
      res.json({ ok: true, profile, uid, botName: api.__botName || null });
    } catch (e) {
      res.status(500).json({ error: e.message?.slice(0, 300) });
    }
  });

  /**
   * GET /api/facebook/image-proxy
   * [FIX] Proxies Facebook CDN images server-side so the browser avoids CORS/referrer blocks.
   * Query: url (encoded Facebook CDN URL), bot (optional)
   */
  router.get("/api/facebook/image-proxy", requireAuth, async (req, res) => {
    const rawUrl = req.query.url;
    if (!rawUrl) return res.status(400).send("url مطلوب");
    // Only allow Facebook CDN domains
    let parsed;
    try { parsed = new URL(rawUrl); } catch { return res.status(400).send("رابط غير صالح"); }
    const allowed = /\.(fbcdn\.net|facebook\.com|fb\.com)$/i;
    if (!allowed.test(parsed.hostname)) return res.status(403).send("نطاق غير مسموح");
    const botIndex = parseInt(req.query.bot) || 1;
    const api = pickBotApi(botIndex);
    const ctx = api?._ctx;
    try {
      // Build cookie header from the FCA jar (if available)
      let cookieHeader = "";
      if (ctx?.jar) {
        const cookies = typeof ctx.jar.getCookies === "function"
          ? ctx.jar.getCookies(rawUrl).map(c => `${c.key}=${c.value}`).join("; ")
          : "";
        cookieHeader = cookies;
      }
      const fetchRes = await fetch(rawUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Referer":    "https://www.facebook.com/",
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
      });
      if (!fetchRes.ok) return res.status(fetchRes.status).send("فشل جلب الصورة");
      const ct = fetchRes.headers.get("content-type") || "image/jpeg";
      res.set("Content-Type", ct);
      res.set("Cache-Control", "public, max-age=86400"); // cache 24h in browser
      // Pipe response body
      const buf = await fetchRes.arrayBuffer();
      res.end(Buffer.from(buf));
    } catch (e) {
      res.status(500).send("خطأ: " + e.message);
    }
  });

  /**
   * GET /api/facebook/friends
   * Returns friends list with optional search & pagination
   * Query: q (search), refresh=1 (force refresh)
   */
  router.get("/api/facebook/friends", requireAuth, async (req, res) => {
    const botIndex = parseInt(req.query.bot) || 1;
    const api = pickBotApi(botIndex);
    if (!api) return res.status(503).json({ error: "لا يوجد بوت متصل حالياً" });
    if (typeof api.getFriendsList !== "function") {
      return res.status(501).json({ error: "getFriendsList غير مدعوم في هذه النسخة" });
    }
    try {
      const force = req.query.refresh === "1";
      const friends = await fetchFriendsList(api, { botIndex, force });
      const q = (req.query.q || "").toLowerCase().trim();
      const filtered = q
        ? friends.filter(f =>
            (f.fullName || "").toLowerCase().includes(q) ||
            (f.firstName || "").toLowerCase().includes(q) ||
            (f.userID || "").includes(q)
          )
        : friends;
      res.json({ ok: true, friends: filtered, total: friends.length });
    } catch (e) {
      res.status(500).json({ error: e.message?.slice(0, 300) });
    }
  });

  /**
   * POST /api/facebook/friends/unfriend
   * Body: { uid }
   */
  router.post("/api/facebook/friends/unfriend", requireAuth, async (req, res) => {
    const { uid } = req.body || {};
    const botIndex = parseInt(req.query.bot) || 1;
    const api = pickBotApi(botIndex);
    if (!api) return res.status(503).json({ error: "لا يوجد بوت متصل حالياً" });
    if (!uid) return res.status(400).json({ error: "uid مطلوب" });
    if (typeof api.unfriend !== "function") return res.status(501).json({ error: "unfriend غير مدعوم" });
    try {
      await new Promise((resolve, reject) => {
        api.unfriend(String(uid), (err) => (err ? reject(err) : resolve()));
      });
      // Invalidate friends cache for this bot
      _friendsCache.delete(botIndex);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message?.slice(0, 300) });
    }
  });

  /**
   * POST /api/facebook/friend-request
   * Accept or reject a friend request by UID
   * Body: { uid, accept: true|false }
   */
  router.post("/api/facebook/friend-request", requireAuth, async (req, res) => {
    const { uid, accept } = req.body || {};
    const botIndex = parseInt(req.query.bot) || 1;
    const api = pickBotApi(botIndex);
    if (!api) return res.status(503).json({ error: "لا يوجد بوت متصل حالياً" });
    if (!uid) return res.status(400).json({ error: "uid مطلوب" });
    if (typeof accept !== "boolean") return res.status(400).json({ error: "accept (boolean) مطلوب" });
    if (typeof api.handleFriendRequest !== "function") {
      return res.status(501).json({ error: "handleFriendRequest غير مدعوم" });
    }
    try {
      await new Promise((resolve, reject) => {
        api.handleFriendRequest(String(uid), accept, (err) => (err ? reject(err) : resolve()));
      });
      if (accept) _friendsCache.delete(botIndex); // friends list changed
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message?.slice(0, 300) });
    }
  });

  /**
   * POST /api/facebook/follow
   * Follow or unfollow a user
   * Body: { uid, follow: true|false }
   */
  router.post("/api/facebook/follow", requireAuth, async (req, res) => {
    const { uid, follow = true } = req.body || {};
    const botIndex = parseInt(req.query.bot) || 1;
    const api = pickBotApi(botIndex);
    if (!api) return res.status(503).json({ error: "لا يوجد بوت متصل حالياً" });
    if (!uid) return res.status(400).json({ error: "uid مطلوب" });
    if (typeof api.follow !== "function") {
      return res.status(501).json({ error: "follow غير مدعوم في هذه النسخة" });
    }
    try {
      await new Promise((resolve, reject) => {
        api.follow(String(uid), Boolean(follow), (err) => (err ? reject(err) : resolve()));
      });
      res.json({ ok: true, following: Boolean(follow) });
    } catch (e) {
      res.status(500).json({ error: e.message?.slice(0, 300) });
    }
  });

  /**
   * POST /api/facebook/post
   * Create a text post/story
   * Body: { body, privacy: "EVERYONE"|"FRIENDS"|"SELF" }
   */
  router.post("/api/facebook/post", requireAuth, async (req, res) => {
    const { body, privacy = "FRIENDS" } = req.body || {};
    const botIndex = parseInt(req.query.bot) || 1;
    const api = pickBotApi(botIndex);
    if (!api) return res.status(503).json({ error: "لا يوجد بوت متصل حالياً" });
    if (!body || !String(body).trim()) return res.status(400).json({ error: "النص لا يمكن أن يكون فارغاً" });
    const allowedPrivacy = ["EVERYONE", "FRIENDS", "SELF"];
    const safePrivacy = allowedPrivacy.includes(privacy) ? privacy : "FRIENDS";
    try {
      const result = await _safeCreatePost(api, String(body).trim(), safePrivacy);
      res.json({ ok: true, result });
    } catch (e) {
      res.status(500).json({ error: e.message?.slice(0, 300) });
    }
  });

  /**
   * POST /api/facebook/block
   * Block or unblock a user
   * Body: { uid, blocked: true|false }
   */
  router.post("/api/facebook/block", requireAuth, async (req, res) => {
    const { uid, blocked } = req.body || {};
    const botIndex = parseInt(req.query.bot) || 1;
    const api = pickBotApi(botIndex);
    if (!api) return res.status(503).json({ error: "لا يوجد بوت متصل حالياً" });
    if (!uid) return res.status(400).json({ error: "uid مطلوب" });
    if (typeof blocked !== "boolean") return res.status(400).json({ error: "blocked (boolean) مطلوب" });
    if (typeof api.changeBlockedStatus !== "function") {
      return res.status(501).json({ error: "changeBlockedStatus غير مدعوم" });
    }
    try {
      await new Promise((resolve, reject) => {
        api.changeBlockedStatus(String(uid), Boolean(blocked), (err) => (err ? reject(err) : resolve()));
      });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message?.slice(0, 300) });
    }
  });

  /**
   * GET /api/facebook/user-info
   * Lookup any user's info by UID
   * Query: uid
   */
  router.get("/api/facebook/user-info", requireAuth, async (req, res) => {
    const { uid } = req.query;
    const botIndex = parseInt(req.query.bot) || 1;
    const api = pickBotApi(botIndex);
    if (!api) return res.status(503).json({ error: "لا يوجد بوت متصل حالياً" });
    if (!uid) return res.status(400).json({ error: "uid مطلوب في query" });
    try {
      const info = await lookupUserInfo(api, String(uid));
      res.json({ ok: true, user: info?.[String(uid)] || null, uid });
    } catch (e) {
      res.status(500).json({ error: e.message?.slice(0, 300) });
    }
  });

  /**
   * GET /api/facebook/stories
   * Returns story events captured from MQTT (in-memory)
   */
  router.get("/api/facebook/stories", requireAuth, (_req, res) => {
    res.json({ ok: true, stories: getStoryEvents(), friendEvents: getFriendEvents() });
  });

  /**
   * DELETE /api/facebook/stories
   * Clear captured story events from memory
   */
  router.delete("/api/facebook/stories", requireAuth, (_req, res) => {
    clearStoryEvents();
    res.json({ ok: true });
  });

  /**
   * POST /api/facebook/message-requests/accept-all
   * Accept all pending message requests (PENDING + OTHER folders)
   */
  router.post("/api/facebook/message-requests/accept-all", requireAuth, async (req, res) => {
    const botIndex = parseInt(req.query.bot) || 1;
    const api = pickBotApi(botIndex);
    if (!api) return res.status(503).json({ error: "لا يوجد بوت متصل حالياً" });
    try {
      const results = [];
      for (const tag of ["PENDING", "OTHER"]) {
        let list;
        try { list = await api.getThreadList(50, null, [tag]); } catch { continue; }
        if (!Array.isArray(list) || list.length === 0) continue;
        const ids = list.map(t => t.threadID).filter(Boolean);
        // Process in batches of 10
        for (let i = 0; i < ids.length; i += 10) {
          const batch = ids.slice(i, i + 10);
          await new Promise(resolve => {
            api.handleMessageRequest(batch, true, err => {
              batch.forEach(id => results.push({ id, ok: !err, folder: tag }));
              resolve();
            });
          });
          await new Promise(r => setTimeout(r, 300));
        }
      }
      res.json({ ok: true, processed: results.length, results });
    } catch (e) {
      res.status(500).json({ error: e.message?.slice(0, 300) });
    }
  });

  /**
   * POST /api/facebook/send-message
   * Send a message to any thread or user
   * Body: { threadID, message, replyTo? }
   */
  router.post("/api/facebook/send-message", requireAuth, async (req, res) => {
    const { threadID, message, replyTo } = req.body || {};
    const botIndex = parseInt(req.query.bot) || 1;
    const api = pickBotApi(botIndex);
    if (!api) return res.status(503).json({ error: "لا يوجد بوت متصل حالياً" });
    if (!threadID) return res.status(400).json({ error: "threadID مطلوب" });
    if (!message || !String(message).trim()) return res.status(400).json({ error: "الرسالة فارغة" });
    try {
      const result = await new Promise((resolve, reject) => {
        global.safeSend(
          api,
          String(message),
          String(threadID),
          (err, info) => (err ? reject(err) : resolve(info)),
          replyTo ? String(replyTo) : undefined
        );
      });
      res.json({ ok: true, result });
    } catch (e) {
      res.status(500).json({ error: e.message?.slice(0, 300) });
    }
  });

  /**
   * GET /api/facebook/thread-info
   * Get info about a specific thread/conversation
   * Query: tid
   */
  router.get("/api/facebook/thread-info", requireAuth, async (req, res) => {
    const { tid } = req.query;
    const botIndex = parseInt(req.query.bot) || 1;
    const api = pickBotApi(botIndex);
    if (!api) return res.status(503).json({ error: "لا يوجد بوت متصل حالياً" });
    if (!tid) return res.status(400).json({ error: "tid مطلوب" });
    try {
      const info = await new Promise((resolve, reject) => {
        api.getThreadInfo(String(tid), (err, r) => (err ? reject(err) : resolve(r)));
      });
      res.json({ ok: true, thread: info });
    } catch (e) {
      res.status(500).json({ error: e.message?.slice(0, 300) });
    }
  });

  /**
   * POST /api/facebook/react-post
   * React to a Facebook post
   * Body: { postID, reaction } — reaction: "LIKE"|"LOVE"|"HAHA"|"WOW"|"SAD"|"ANGRY"|"NONE"
   */
  router.post("/api/facebook/react-post", requireAuth, async (req, res) => {
    const { postID, reaction = "LIKE" } = req.body || {};
    const botIndex = parseInt(req.query.bot) || 1;
    const api = pickBotApi(botIndex);
    if (!api) return res.status(503).json({ error: "لا يوجد بوت متصل حالياً" });
    if (!postID) return res.status(400).json({ error: "postID مطلوب" });
    if (typeof api.setPostReaction !== "function") {
      return res.status(501).json({ error: "setPostReaction غير مدعوم" });
    }
    try {
      const result = await new Promise((resolve, reject) => {
        api.setPostReaction(String(postID), String(reaction), (err, r) =>
          err ? reject(err) : resolve(r)
        );
      });
      res.json({ ok: true, result });
    } catch (e) {
      res.status(500).json({ error: e.message?.slice(0, 300) });
    }
  });

  // ─── Register static + router ───
  app.use("/dashboard", router);
  app.use("/dashboard", express.static(PUBLIC_DIR));
  console.log(chalk.green("[DASHBOARD] ✅ لوحة التحكم متاحة على /dashboard"));
}

export { registerDashboard };
