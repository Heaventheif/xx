"use strict";

import crypto from "node:crypto";
import * as dashboardUsers from "./users.js";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const sessions = new Map();

function parseCookies(req) {
  const result = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      result[key] = part.slice(index + 1).trim();
    }
  }
  return result;
}

function isSecureRequest(req) {
  return req.secure || req.headers["x-forwarded-proto"] === "https";
}

function setSessionCookie(req, res, sessionId, maxAgeMs) {
  const attributes = [
    `fca_sid=${encodeURIComponent(sessionId)}`,
    "Path=/dashboard",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (isSecureRequest(req)) attributes.push("Secure");
  res.setHeader("Set-Cookie", attributes.join("; "));
}

function clearSessionCookie(req, res) {
  const attributes = [
    "fca_sid=",
    "Path=/dashboard",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
  ];
  if (isSecureRequest(req)) attributes.push("Secure");
  res.setHeader("Set-Cookie", attributes.join("; "));
}

function cleanupSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id);
  }
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyEnvironmentUser(username, password) {
  const expectedUsername = process.env.DASHBOARD_USERNAME?.trim();
  const expectedPassword = process.env.DASHBOARD_PASSWORD;
  if (!expectedUsername || !expectedPassword) return false;
  return constantTimeEqual(username, expectedUsername) &&
    constantTimeEqual(password, expectedPassword);
}

export function initDashboardAuth(projectRoot) {
  dashboardUsers.init(projectRoot);
  cleanupSessions();
  if (!process.env.DASHBOARD_USERNAME || !process.env.DASHBOARD_PASSWORD) {
    console.warn(
      "[DASHBOARD-AUTH] ⚠️ اضبط DASHBOARD_USERNAME وDASHBOARD_PASSWORD " +
      "لتسجيل الدخول إلى لوحة التحكم."
    );
  }
}

export async function loginDashboard(req, res) {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");

  const envMatch = verifyEnvironmentUser(username, password);
  const stored = envMatch
    ? { ok: true, username }
    : await dashboardUsers.verifyUser(username, password);

  if (!stored.ok) {
    const configuredUsers = dashboardUsers.userCount();
    const authConfigured = envMatch ||
      configuredUsers === null ||
      configuredUsers > 0;
    return res.status(authConfigured ? 401 : 503).json({
      error: stored.error || "بيانات الدخول غير صحيحة",
    });
  }

  const sessionId = crypto.randomBytes(32).toString("hex");
  sessions.set(sessionId, {
    username: stored.username || username,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  setSessionCookie(req, res, sessionId, SESSION_TTL_MS);
  return res.json({ ok: true });
}

export function logoutDashboard(req, res) {
  const sessionId = parseCookies(req).fca_sid;
  if (sessionId) sessions.delete(sessionId);
  clearSessionCookie(req, res);
  return res.json({ ok: true });
}

export function requireDashboardAuth(req, res, next) {
  cleanupSessions();
  const sessionId = parseCookies(req).fca_sid;
  const session = sessionId ? sessions.get(sessionId) : null;
  if (!session || session.expiresAt <= Date.now()) {
    return res.status(401).json({ error: "unauthorized" });
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return next();
}

export function dashboardIdentity(req) {
  const sessionId = parseCookies(req).fca_sid;
  return sessionId ? sessions.get(sessionId)?.username || null : null;
}