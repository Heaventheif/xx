#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const url = process.env.PROBE_URL || "https://www.facebook.com/";
const htmlFile = process.env.PROBE_HTML_FILE || path.resolve("probe-facebook.html");
const jarFile = process.env.COOKIE_JAR_FILE || "";
const appStateRaw = process.env.APPSTATE || "";

function marker(html, pattern) {
  return pattern.test(html);
}

function safeCookieMeta(cookie) {
  return {
    name: cookie.key || cookie.name || "",
    domain: cookie.domain || null,
    path: cookie.path || "/",
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly),
    sameSite: cookie.sameSite || null,
    expired: typeof cookie.expiryTime === "function" ? cookie.expiryTime() <= Date.now() : null,
  };
}

function printReport(report) {
  console.log(JSON.stringify({
    probe: "non-invasive",
    timestamp: new Date().toISOString(),
    ...report,
  }, null, 2));
}

async function readHtml() {
  if (process.env.PROBE_USE_NETWORK === "off") {
    return await fs.readFile(htmlFile, "utf8");
  }
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "Mozilla/5.0 (compatible; non-invasive-probe/1.0)" },
  });
  const html = await response.text();
  await fs.writeFile(htmlFile, html, "utf8");
  return html;
}

function inspectHtml(html) {
  const hasDtsgInitData = /["']DTSGInitData["']/.test(html);
  const hasDtsgInitialData = /["']DTSGInitialData["']/.test(html);
  const hasDtsgToken = /["']DTSG(?:Init|Initial)Data["']\s*,\s*\[\s*\]\s*,\s*\{[^}]*["'](?:token|async_get_token)["']\s*:\s*["'][^"']+["']/i.test(html);
  const hasLsdRequire = /\[\s*["']LSD["']\s*,\s*\[\]\s*,\s*\{\s*["']token["']\s*:/.test(html);
  const hasLsdObject = /["']lsd["']\s*:\s*\{\s*["']name["']\s*:\s*["']lsd["']\s*,\s*["']value["']/.test(html);
  const hasLsdInput = /<input[^>]+name=["']lsd["'][^>]+value=/i.test(html);
  const hasDtsgInput = /<input[^>]+name=["'](?:fb_dtsg|fb_dtsg_ag)["'][^>]+value=/i.test(html);
  const hasJazoest = /["']jazoest["']\s*[:=]/i.test(html);
  return {
    htmlBytes: Buffer.byteLength(html),
    fb_dtsg: { hasDtsgInitData, hasDtsgInitialData, hasToken: hasDtsgToken, hasHiddenInput: hasDtsgInput },
    lsd: { hasLsdRequire, hasLsdObject, hasHiddenInput: hasLsdInput },
    hasJazoest,
  };
}

async function inspectCookieJar() {
  if (!jarFile) return { source: "not_configured", cookieCount: null, cookies: [] };
  const raw = await fs.readFile(jarFile, "utf8");
  const parsed = JSON.parse(raw);
  const hostname = new URL(url).hostname;
  const allCookies = parsed?.store?.idx
    ? Object.values(parsed.store.idx).flatMap((domain) => Object.values(domain || {}))
    : Array.isArray(parsed?.cookies) ? parsed.cookies : [];
  const cookies = allCookies.filter((cookie) => {
    const domain = String(cookie.domain || "").replace(/^\./, "");
    return !domain || hostname === domain || hostname.endsWith(`.${domain}`);
  });
  return {
    source: jarFile,
    cookieCount: cookies.length,
    cookies: cookies.map(safeCookieMeta),
  };
}

function inspectAppState() {
  if (!appStateRaw) return { source: "not_configured", cookieCount: null, cookieNames: [] };
  try {
    const state = JSON.parse(appStateRaw);
    if (!Array.isArray(state)) return { source: "APPSTATE", valid: false, cookieCount: 0, cookieNames: [] };
    return {
      source: "APPSTATE",
      valid: true,
      cookieCount: state.length,
      cookieNames: state.map((cookie) => String(cookie?.key ?? cookie?.name ?? "")).filter(Boolean),
    };
  } catch {
    return { source: "APPSTATE", valid: false, cookieCount: 0, cookieNames: [] };
  }
}

try {
  const html = await readHtml();
  printReport({ html: inspectHtml(html), appState: inspectAppState(), cookieJar: await inspectCookieJar() });
} catch (error) {
  printReport({ error: { name: error.name, message: error.message } });
  process.exitCode = 1;
}
