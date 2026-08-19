/**
 * login-helper.js — شغّله محلياً مرة واحدة فقط
 *
 * يسجّل الدخول بـ email + password + 2FA (TOTP)
 * ثم يحفظ AppState تلقائياً في appstate.json
 *
 * الاستخدام:
 *   FB_EMAIL=... FB_PASSWORD=... bun login-helper.js
 *   FB_EMAIL=... FB_PASSWORD=... FB_TOTP_SECRET=JBSWY3DPEHPK3PXP bun login-helper.js
 *   FB_EMAIL=... FB_PASSWORD=... FB_2FA_CODE=123456 bun login-helper.js
 *
 * متغيرات البيئة:
 *   FB_EMAIL         - البريد الإلكتروني لحساب فيسبوك
 *   FB_PASSWORD      - كلمة المرور
 *   FB_TOTP_SECRET   - مفتاح TOTP السري (Base32) لتوليد الكود تلقائياً
 *   FB_2FA_CODE      - كود 2FA يدوي (بديل عن TOTP_SECRET)
 *   OUTPUT_FILE      - مسار ملف الإخراج (افتراضي: appstate.json)
 *   LOCAL_PORT       - منفذ الخادم المحلي (افتراضي: 17649)
 */

"use strict";

import * as fcaModule from "fca-unofficial";
import fs from "fs-extra";
import path from "path";
import { createInterface } from "readline";

// ── إعداد ───────────────────────────────────────────────────────────────────

const FB_EMAIL      = process.env.FB_EMAIL      || "";
const FB_PASSWORD   = process.env.FB_PASSWORD   || "";

// Mirror to FCA_EMAIL / FCA_PASSWORD for fca-main's resolveCredentialsFromEnv()
if (FB_EMAIL)    process.env.FCA_EMAIL    = FB_EMAIL;
if (FB_PASSWORD) process.env.FCA_PASSWORD = FB_PASSWORD;
const FB_TOTP_SECRET= process.env.FB_TOTP_SECRET|| "";
const FB_2FA_CODE   = process.env.FB_2FA_CODE   || "";
const OUTPUT_FILE   = process.env.OUTPUT_FILE   || "appstate.json";
const LOCAL_PORT    = parseInt(process.env.LOCAL_PORT || "17649", 10);

const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red:   "\x1b[31m",
  cyan:  "\x1b[36m",
  bold:  "\x1b[1m",
};
const log  = (msg) => console.log(`${COLORS.cyan}[HELPER]${COLORS.reset} ${msg}`);
const ok   = (msg) => console.log(`${COLORS.green}[✅ OK]${COLORS.reset} ${msg}`);
const warn = (msg) => console.log(`${COLORS.yellow}[⚠️  WARN]${COLORS.reset} ${msg}`);
const err  = (msg) => console.log(`${COLORS.red}[❌ ERR]${COLORS.reset} ${msg}`);

// ── توليد TOTP — نستخدم generateTOTP من fca-unofficial مباشرةً ─────────────
// fca يُصدِّر generateTOTP جاهزة (utils/totp.js) لذا لا نحتاج totp-generator

const _fcaGenerateTOTP = fcaModule.generateTOTP;

function generateTOTP(secret) {
  if (typeof _fcaGenerateTOTP === "function") {
    return _fcaGenerateTOTP(secret.replace(/\s+/g, "").toUpperCase());
  }
  throw new Error("generateTOTP غير متاح من fca-unofficial — تحقق من الإصدار");
}

// ── تفاعل readline ──────────────────────────────────────────────────────────

function prompt(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

// ── تسجيل دخول Facebook عبر HTTP المباشر ─────────────────────────────────

// Desktop UA matching fca-2026 stealth-profiles pool (Aug 2026).
// Desktop gives more consistent cookie behavior with m.facebook.com than
// a Mobile UA, and matches what the bot uses at runtime.
const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/152.0.7947.67 Safari/537.36";

/** استخراج قيمة حقل مخفي من HTML */
function extractField(html, name) {
  const re = new RegExp(`name=["']${name}["'][^>]*value=["']([^"']+)["']`, "i");
  const m = html.match(re) ||
            html.match(new RegExp(`value=["']([^"']+)["'][^>]*name=["']${name}["']`, "i"));
  return m?.[1] || "";
}

/** استخراج جميع حقول <input> المخفية */
function extractHiddenFields(html) {
  const fields = {};
  const re = /<input[^>]+type=["']?hidden["']?[^>]*>/gi;
  for (const match of html.matchAll(re)) {
    const tag = match[0];
    const nameM = tag.match(/name=["']([^"']+)["']/i);
    const valM  = tag.match(/value=["']([^"']*?)["']/i);
    if (nameM && valM) fields[nameM[1]] = valM[1];
  }
  return fields;
}

/** طبقة Cookie jar بسيطة */
function makeCookieJar() {
  const jar = new Map();

  function setCookieFromHeader(headerVal, defaultDomain = ".facebook.com") {
    const parts = headerVal.split(";").map(s => s.trim());
    const [kv, ...attrs] = parts;
    const eqIdx = kv.indexOf("=");
    if (eqIdx <= 0) return;
    const key   = kv.slice(0, eqIdx).trim();
    const value = kv.slice(eqIdx + 1).trim();
    const domainAttr = attrs.find(a => /^domain=/i.test(a));
    const domain = domainAttr ? domainAttr.replace(/^domain=/i, "") : defaultDomain;
    jar.set(key, { key, value, domain, path: "/" });
  }

  function parseCookiesFromResponse(resp) {
    const setCookie = resp.headers.getSetCookie?.() ?? [];
    for (const c of setCookie) setCookieFromHeader(c);
  }

  function getHeader() {
    return [...jar.values()].map(c => `${c.key}=${c.value}`).join("; ");
  }

  function toAppStateArray() {
    const now = Date.now();
    return [...jar.values()].map(c => ({
      key:     c.key,
      value:   c.value,
      domain:  c.domain || ".facebook.com",
      path:    c.path   || "/",
      hostOnly: false,
      creation:  new Date(now).toISOString(),
      lastAccessed: new Date(now).toISOString(),
    }));
  }

  function get(key) { return jar.get(key)?.value || null; }
  function size()   { return jar.size; }

  return { setCookieFromHeader, parseCookiesFromResponse, getHeader, toAppStateArray, get, size };
}

/**
 * تسجيل الدخول الخام عبر m.facebook.com
 * يعيد { uid, cookiesArray } عند النجاح
 * يرمي خطأ عند الفشل
 */
async function rawFacebookLogin(email, password, twoFactor = null) {
  const jar = makeCookieJar();

  const baseHeaders = () => ({
    "User-Agent"     : DEFAULT_UA,
    "Accept"         : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection"     : "keep-alive",
    "Cookie"         : jar.getHeader(),
  });

  async function GET(url) {
    const resp = await fetch(url, { headers: baseHeaders() });
    jar.parseCookiesFromResponse(resp);
    const text = await resp.text();
    return { resp, text, finalUrl: resp.url };
  }

  async function POST(url, body, referer) {
    const resp = await fetch(url, {
      method : "POST",
      headers: {
        ...baseHeaders(),
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer"     : referer || "https://m.facebook.com/",
        "Origin"      : "https://m.facebook.com",
      },
      body   : new URLSearchParams(body).toString(),
      redirect: "follow",
    });
    jar.parseCookiesFromResponse(resp);
    const text = await resp.text();
    return { resp, text, finalUrl: resp.url };
  }

  // ── الخطوة 1: جلب الصفحة الرئيسية للحصول على Tokens ──────────────────
  log("جلب صفحة m.facebook.com ...");
  const { text: initHtml } = await GET("https://m.facebook.com/");

  const lsd     = extractField(initHtml, "lsd");
  const jazoest = extractField(initHtml, "jazoest");

  // ── الخطوة 2: إرسال بيانات تسجيل الدخول ──────────────────────────────
  log("إرسال بيانات تسجيل الدخول ...");
  const loginPayload = {
    email,
    pass : password,
    login: "Log In",
    lsd,
    jazoest,
    m_ts              : Math.floor(Date.now() / 1000).toString(),
    li                : "0",
    trynum            : "1",
    unrecognized_tries: "0",
  };

  const { text: postHtml, finalUrl: postUrl } =
    await POST(
      "https://m.facebook.com/login/device-based/regular/login/?login_source=26",
      loginPayload,
      "https://m.facebook.com/"
    );

  let currentHtml = postHtml;
  let currentUrl  = postUrl;

  // ── الخطوة 3: التعامل مع Checkpoint (2FA) ────────────────────────────
  const isCheckpoint = (url, html) =>
    url.includes("/checkpoint") ||
    html.includes("approvals_code") ||
    html.includes("id=\"checkpointSubmitButton\"") ||
    html.includes("two_factor") ||
    html.includes("authentication code");

  let checkpointPasses = 0;
  while (isCheckpoint(currentUrl, currentHtml) && checkpointPasses < 5) {
    checkpointPasses++;
    log(`Checkpoint مكتشف (المحاولة ${checkpointPasses}) ...`);

    // اكتشاف نوع Checkpoint: هل يطلب رمز 2FA؟
    const needs2FA =
      currentHtml.includes("approvals_code") ||
      currentHtml.includes("id=\"approvals_code\"") ||
      currentHtml.includes("Enter the code") ||
      currentHtml.includes("authentication code");

    if (needs2FA && !twoFactor) {
      throw new Error(
        "حساب هذا محمي بالتحقق الثنائي (2FA).\n" +
        "  → أضف FB_TOTP_SECRET=<Base32 secret> أو FB_2FA_CODE=<6 أرقام>"
      );
    }

    // استخراج حقول النموذج
    const hiddenFields = extractHiddenFields(currentHtml);
    const actionMatch  = currentHtml.match(/<form[^>]+action="([^"]+)"/i);
    let actionUrl      = actionMatch?.[1] || currentUrl;
    if (!actionUrl.startsWith("http")) {
      actionUrl = "https://m.facebook.com" + actionUrl;
    }
    // فك ترميز الـ HTML entities
    actionUrl = actionUrl.replace(/&amp;/g, "&");

    const payload = { ...hiddenFields };

    if (needs2FA && twoFactor) {
      payload["approvals_code"] = twoFactor.replace(/\s+/g, "");
      log(`إرسال رمز 2FA: ${twoFactor}`);
    }

    // بعض صفحات Checkpoint تطلب الضغط على Continue فقط
    const hasSubmitName = currentHtml.match(/name=["'](submit\[([^\]]+)\])["']/i);
    if (hasSubmitName) {
      payload[hasSubmitName[1]] = hasSubmitName[2];
    }

    const { text: cpHtml, finalUrl: cpUrl } =
      await POST(actionUrl, payload, currentUrl);

    currentHtml = cpHtml;
    currentUrl  = cpUrl;

    // في بعض الحالات هناك صفحة ثانية "هل تثق بهذا المتصفح؟"
    if (
      currentHtml.includes("name=\"submit[This was me]\"") ||
      currentHtml.includes("name=\"submit[This Is Okay]\"") ||
      currentHtml.includes("save_device")
    ) {
      const hiddenFields2 = extractHiddenFields(currentHtml);
      const actionMatch2  = currentHtml.match(/<form[^>]+action="([^"]+)"/i);
      let actionUrl2 = actionMatch2?.[1] || currentUrl;
      if (!actionUrl2.startsWith("http")) actionUrl2 = "https://m.facebook.com" + actionUrl2;
      actionUrl2 = actionUrl2.replace(/&amp;/g, "&");

      const submitKey = currentHtml.includes("This was me")
        ? "submit[This was me]"
        : "submit[This Is Okay]";

      const { text: html3, finalUrl: url3 } =
        await POST(actionUrl2, { ...hiddenFields2, [submitKey]: "Continue" }, currentUrl);

      currentHtml = html3;
      currentUrl  = url3;
    }
  }

  // ── الخطوة 4: التحقق من نجاح تسجيل الدخول ────────────────────────────
  const uid = jar.get("c_user") || jar.get("i_user");

  if (!uid || uid === "0") {
    // محاولة أخيرة: جلب الصفحة الرئيسية
    const { text: homeHtml } = await GET("https://www.facebook.com/");
    const uidFromHtml = homeHtml.match(/"USER_ID"\s*:\s*"(\d+)"/)?.[1] ||
                        homeHtml.match(/"c_user"\s*:\s*"(\d+)"/)?.[1];

    if (!uidFromHtml || uidFromHtml === "0") {
      throw new Error("فشل تسجيل الدخول — لم يتم العثور على معرّف المستخدم في الكوكيز");
    }
  }

  const finalUid = jar.get("c_user") || jar.get("i_user");
  ok(`تسجيل الدخول ناجح! UID: ${finalUid}`);

  return {
    uid    : finalUid,
    cookies: jar.toAppStateArray(),
  };
}

// ── خادم API محلي لـ loginViaAPI ─────────────────────────────────────────

async function startLocalApiServer(email, password, twoFactor, port) {
  return new Promise((resolve) => {
    const server = Bun.serve({
      port,
      async fetch(req) {
        const url = new URL(req.url);

        if (req.method === "POST" && url.pathname === "/api/v1/facebook/login_ios") {
          try {
            log("الخادم المحلي: استلام طلب تسجيل الدخول ...");
            const result = await rawFacebookLogin(email, password, twoFactor);

            return Response.json({
              uid        : result.uid,
              user_id    : result.uid,
              access_token: "",
              cookie     : result.cookies.map(c => `${c.key}=${c.value}`).join("; "),
              cookies    : result.cookies,
            });
          } catch (e) {
            err(`خطأ في الخادم المحلي: ${e.message}`);
            return Response.json({ error: e.message }, { status: 500 });
          }
        }

        return new Response("Not Found", { status: 404 });
      },
    });

    log(`الخادم المحلي يعمل على http://localhost:${port}`);
    resolve(server);
  });
}

// ── دالة طلب بيانات تسجيل الدخول تفاعلياً ───────────────────────────────

async function collectCredentials() {
  let email    = FB_EMAIL;
  let password = FB_PASSWORD;
  let twoFactor = null;

  if (!email) {
    email = await prompt("📧 البريد الإلكتروني: ");
  }
  if (!password) {
    password = await prompt("🔑 كلمة المرور: ");
  }

  if (!email || !password) {
    throw new Error("يجب توفير البريد الإلكتروني وكلمة المرور");
  }

  // توليد/جلب رمز 2FA
  if (FB_TOTP_SECRET) {
    twoFactor = generateTOTP(FB_TOTP_SECRET);
    log(`رمز 2FA (TOTP) المولَّد: ${COLORS.bold}${twoFactor}${COLORS.reset}`);
  } else if (FB_2FA_CODE) {
    twoFactor = FB_2FA_CODE.replace(/\s+/g, "");
    log(`رمز 2FA المُدخَل يدوياً: ${COLORS.bold}${twoFactor}${COLORS.reset}`);
  } else {
    const ask = await prompt(
      "❓ هل الحساب محمي بالتحقق الثنائي (2FA)؟ [y/n]: "
    );
    if (ask.toLowerCase() === "y") {
      const secretOrCode = await prompt(
        "أدخل مفتاح TOTP (Base32) أو رمز 6 أرقام مباشرةً: "
      );
      const cleaned = secretOrCode.replace(/\s+/g, "");
      if (/^\d{6}$/.test(cleaned)) {
        twoFactor = cleaned;
      } else {
        twoFactor = generateTOTP(cleaned);
        log(`رمز 2FA المولَّد: ${COLORS.bold}${twoFactor}${COLORS.reset}`);
      }
    }
  }

  return { email, password, twoFactor };
}

// ── الدالة الرئيسية ──────────────────────────────────────────────────────

async function main() {
  console.log(`\n${COLORS.bold}${COLORS.cyan}╔══════════════════════════════════════╗`);
  console.log("║    Facebook AppState Login Helper    ║");
  console.log(`╚══════════════════════════════════════╝${COLORS.reset}\n`);

  const { email, password, twoFactor } = await collectCredentials();

  log(`تسجيل الدخول لـ: ${email}`);

  // ── خيار 1: محاولة AppState مباشرة (إن وُجد) ─────────────────────────
  const existingPath = path.join(import.meta.dir, OUTPUT_FILE);
  if (await fs.pathExists(existingPath)) {
    warn(`وُجد ${OUTPUT_FILE} موجود مسبقاً — سيتم استبداله`);
  }

  let server = null;
  let api    = null;

  try {
    // ── تشغيل الخادم المحلي ──────────────────────────────────────────
    server = await startLocalApiServer(email, password, twoFactor, LOCAL_PORT);

    const loginViaAPI = fcaModule.loginViaAPI;
    if (typeof loginViaAPI !== "function") {
      throw new Error("loginViaAPI غير متاح من fca-unofficial");
    }

    // ── طلب loginViaAPI مع الخادم المحلي ────────────────────────────
    log("استدعاء loginViaAPI مع الخادم المحلي ...");
    const apiResult = await loginViaAPI(
      email,
      password,
      twoFactor,
      `http://localhost:${LOCAL_PORT}`
    );

    if (!apiResult?.ok) {
      throw new Error(`loginViaAPI فشل: ${apiResult?.message || "سبب غير معروف"}`);
    }

    ok(`loginViaAPI ناجح — UID: ${apiResult.uid}`);

    // ── بناء AppState كامل باستخدام login() ─────────────────────────
    const appStateCookies = apiResult.cookies?.length
      ? apiResult.cookies
      : (apiResult.cookie
          ? apiResult.cookie.split(";").map(kv => {
              const idx = kv.indexOf("=");
              if (idx <= 0) return null;
              return {
                key: kv.slice(0, idx).trim(),
                value: kv.slice(idx + 1).trim(),
                domain: ".facebook.com",
                path: "/",
              };
            }).filter(Boolean)
          : []);

    if (!appStateCookies.length) {
      throw new Error("لا يوجد cookies في نتيجة loginViaAPI");
    }

    log("تسجيل الدخول بالـ AppState للحصول على API handle ...");

    api = await new Promise((resolve, reject) => {
      fcaModule.login({ appState: appStateCookies }, (e, apiHandle) => {
        if (e) return reject(e);
        resolve(apiHandle);
      });
    });

    ok("تم الحصول على API handle بنجاح");

    // ── حفظ AppState ─────────────────────────────────────────────────
    const finalState = api.getAppState();
    const outPath    = path.join(import.meta.dir, OUTPUT_FILE);
    await fs.writeJson(outPath, finalState, { spaces: 2 });

    ok(`✅ AppState محفوظ في: ${outPath}`);
    log(`عدد الكوكيز: ${finalState.length}`);

  } catch (loginErr) {
    // ── Fallback: تسجيل دخول مباشر بدون loginViaAPI ─────────────────
    warn(`loginViaAPI فشل، جاري المحاولة المباشرة: ${loginErr.message}`);

    try {
      log("تسجيل دخول مباشر عبر rawFacebookLogin ...");
      const { uid, cookies } = await rawFacebookLogin(email, password, twoFactor);

      const outPath = path.join(import.meta.dir, OUTPUT_FILE);
      await fs.writeJson(outPath, cookies, { spaces: 2 });

      ok(`✅ AppState (cookies) محفوظ في: ${outPath}`);
      log(`UID: ${uid} | عدد الكوكيز: ${cookies.length}`);
      warn(
        "ملاحظة: تم حفظ cookies مباشرة بدون api.getAppState() — " +
        "قد تحتاج إلى إعادة تسجيل الدخول في وقت أبكر من المعتاد"
      );

    } catch (fallbackErr) {
      err(`فشل تام: ${fallbackErr.message}`);
      process.exit(1);
    }
  } finally {
    if (server) {
      try { server.stop(true); } catch (_) {}
      log("أُغلق الخادم المحلي");
    }
  }

  console.log(`\n${COLORS.green}${COLORS.bold}انتهى بنجاح! انسخ ${OUTPUT_FILE} إلى بيئة الإنتاج (Render/VPS).${COLORS.reset}\n`);
  process.exit(0);
}

main().catch(e => {
  err(e.message);
  process.exit(1);
});
