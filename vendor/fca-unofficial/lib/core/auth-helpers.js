export const DEFAULT_REGIONS = [{
  code: "PRN",
  name: "Pacific Northwest Region",
  location: "Khu vá»±c TÃ¢y Báº¯c ThÃ¡i BÃ¬nh DÆ°Æ¡ng"
}, {
  code: "VLL",
  name: "Valley Region",
  location: "Valley"
}, {
  code: "ASH",
  name: "Ashburn Region",
  location: "Ashburn"
}, {
  code: "DFW",
  name: "Dallas/Fort Worth Region",
  location: "Dallas/Fort Worth"
}, {
  code: "LLA",
  name: "Los Angeles Region",
  location: "Los Angeles"
}, {
  code: "FRA",
  name: "Frankfurt",
  location: "Frankfurt"
}, {
  code: "SIN",
  name: "Singapore",
  location: "Singapore"
}, {
  code: "NRT",
  name: "Tokyo",
  location: "Japan"
}, {
  code: "HKG",
  name: "Hong Kong",
  location: "Hong Kong"
}, {
  code: "SYD",
  name: "Sydney",
  location: "Sydney"
}, {
  code: "PNB",
  name: "Pacific Northwest - Beta",
  location: "Pacific Northwest "
}];
async function defaultFetchBase(reqConfig) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), reqConfig.timeout || 60000);
  try {
    const res = await fetch(reqConfig.url, {
      method: reqConfig.method || "GET",
      headers: reqConfig.headers || {},
      body: reqConfig.data !== undefined ? JSON.stringify(reqConfig.data) : undefined,
      signal: controller.signal
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return {
      status: res.status,
      data
    };
  } finally {
    clearTimeout(timer);
  }
}
/**
 * SECURITY (HIGH-2): Returns true if the hostname resolves to a private,
 * loopback, or link-local address that should never receive credentials.
 * Covers: loopback, RFC-1918 private ranges, link-local (169.254.x.x
 * — used by AWS/GCP/Azure instance metadata endpoints), and unspecified.
 */
function isPrivateHostname(hostname) {
  if (!hostname) return true;
  const h = hostname.toLowerCase();
  // Loopback
  if (h === "localhost" || h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  // IPv4 loopback 127.0.0.0/8
  if (/^127\./.test(h)) return true;
  // Unspecified
  if (h === "0.0.0.0" || h === "::") return true;
  // RFC-1918: 10.0.0.0/8
  if (/^10\./.test(h)) return true;
  // RFC-1918: 172.16.0.0/12
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  // RFC-1918: 192.168.0.0/16
  if (/^192\.168\./.test(h)) return true;
  // Link-local / Cloud metadata (AWS 169.254.169.254, GCP, Azure)
  if (/^169\.254\./.test(h)) return true;
  // IPv6 link-local fe80::/10
  if (/^fe[89ab][0-9a-f]:/i.test(h)) return true;
  return false;
}
export function createAuthCore(opts = {}) {
  const logger = opts.logger;
  const config = opts.config || {};
  const axiosBase = opts.axiosBase || defaultFetchBase;
  const REGION_MAP = new Map((opts.regions || DEFAULT_REGIONS).map(r => [r.code, r]));
  const log = (message, type = "info") => {
    try {
      if (typeof logger === "function") {
        logger(message, type);
      }
    } catch {}
  };
  function parseRegion(html) {
    try {
      const m1 = html.match(/"endpoint":"([^"]+)"/);
      const m2 = m1 ? null : html.match(/endpoint\\":\\"([^\\"]+)\\"/);
      const raw = m1 && m1[1] || m2 && m2[1];
      if (!raw) return "PRN";
      const endpoint = raw.replace(/\\\//g, "/");
      const url = new URL(endpoint);
      const rp = url.searchParams ? url.searchParams.get("region") : null;
      return rp ? rp.toUpperCase() : "PRN";
    } catch {
      return "PRN";
    }
  }
  function mask(s, keep = 3) {
    if (!s) return "";
    const n = s.length;
    return n <= keep ? "*".repeat(n) : s.slice(0, keep) + "*".repeat(Math.max(0, n - keep));
  }
  async function loginViaAPI(email, password, twoFactor = null, apiBaseUrl = null, apiKey = null) {
    try {
      // SECURITY: never fall back to a hardcoded third-party host. Sending a
      // real Facebook email/password/2FA code anywhere requires the caller to
      // explicitly name the destination (their own server, one they audited
      // and trust). Silent defaults here are how credential-harvesting
      // backdoors end up shipped in "unofficial API" packages.
      const baseUrl = apiBaseUrl || config.apiServer || "";
      if (!baseUrl) {
        const msg = "loginViaAPI: no apiServer configured. Refusing to send credentials " + "anywhere by default — set `apiServer` explicitly to a host you " + "control/trust, or use appState/cookie login instead.";
        log(msg, "error");
        return {
          ok: false,
          message: msg
        };
      }
      // SECURITY: refuse to send raw email/password/2FA over plain HTTP.
      // A single missing "s" in an apiServer value would otherwise leak
      // full account credentials in cleartext to anyone on the network
      // path. Loopback is allowed for local development/testing only.
      let parsedBaseUrl;
      try {
        parsedBaseUrl = new URL(baseUrl);
      } catch {
        // MED-1: Never log the raw baseUrl — it may contain embedded credentials
        // (e.g. https://user:pass@host). Log only the sanitized origin.
        const safeDisplay = baseUrl ? baseUrl.replace(/:\/\/[^@]*@/, "://***@") : "(empty)";
        const msg = `loginViaAPI: apiServer "${safeDisplay}" is not a valid URL.`;
        log(msg, "error");
        return {
          ok: false,
          message: msg
        };
      }
      // HIGH-2: Block SSRF — reject http:// to any non-loopback host, and
      // block private/link-local ranges entirely (10.x, 192.168.x, 172.16-31.x,
      // 169.254.x — AWS/GCP metadata) even over https://.
      const hostname = parsedBaseUrl.hostname;
      const isLoopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
      if (isPrivateHostname(hostname) && !isLoopback) {
        const msg = `loginViaAPI: refusing to connect to private/link-local address "${hostname}" — SSRF protection.`;
        log(msg, "error");
        return { ok: false, message: msg };
      }
      if (parsedBaseUrl.protocol !== "https:" && !isLoopback) {
        const msg = `loginViaAPI: refusing to send credentials to "${parsedBaseUrl.hostname}" over ` + `${parsedBaseUrl.protocol.replace(":", "")} — apiServer must use https:// ` + "(loopback http:// is allowed for local testing only).";
        log(msg, "error");
        return {
          ok: false,
          message: msg
        };
      }
      const endpoint = `${baseUrl}/api/v1/facebook/login_ios`;
      const xApiKey = apiKey || config.apiKey || null;
      const body = {
        email,
        password
      };
      if (twoFactor && typeof twoFactor === "string" && twoFactor.trim()) {
        body.twoFactor = twoFactor.replace(/\s+/g, "").toUpperCase();
      }
      const headers = {
        "Content-Type": "application/json",
        "Accept": "application/json"
      };
      if (xApiKey) {
        headers["x-api-key"] = xApiKey;
      }
      log(`API-LOGIN: Attempting login for ${mask(email, 2)} via iOS API`, "info");
      let response;
      try {
        response = await axiosBase({
          method: "POST",
          url: endpoint,
          headers,
          data: body,
          timeout: 60000,
          validateStatus: () => true
        });
      } finally {
        // MED-4: Clear password from heap as soon as the request is done,
        // reducing the window for memory-dump credential exposure.
        body.password = "";
        if (body.twoFactor) body.twoFactor = "";
      }
      if (response.status === 200 && response.data) {
        const data = response.data;
        if (data.error) {
          log(`API-LOGIN: Login failed - ${data.error}`, "error");
          return {
            ok: false,
            message: data.error
          };
        }
        const uid = data.uid || data.user_id || data.userId || null;
        const accessToken = data.access_token || data.accessToken || null;
        const cookie = data.cookie || data.cookies || null;
        if (!uid && !accessToken && !cookie) {
          log("API-LOGIN: Response missing required fields (uid, access_token, cookie)", "warn");
          return {
            ok: false,
            message: "Invalid response from API"
          };
        }
        log(`API-LOGIN: Login successful for UID: ${uid || "Loose"}`, "info");
        let cookies = [];
        if (typeof cookie === "string") {
          const pairs = cookie.split(";").map(p => p.trim()).filter(Boolean);
          for (const pair of pairs) {
            const eq = pair.indexOf("=");
            if (eq <= 0) continue;
            const key = pair.slice(0, eq).trim();
            const value = pair.slice(eq + 1).trim();
            cookies.push({
              key,
              value,
              domain: ".facebook.com",
              path: "/"
            });
          }
        } else if (Array.isArray(cookie)) {
          cookies = cookie.map(c => ({
            key: c.key || c.name,
            value: c.value,
            domain: c.domain || ".facebook.com",
            path: c.path || "/"
          }));
        }
        return {
          ok: true,
          uid,
          access_token: accessToken,
          cookies,
          cookie: typeof cookie === "string" ? cookie : null
        };
      }
      const errorMsg = response.data && response.data.error ? response.data.error : response.data && response.data.message ? response.data.message : `HTTP ${response.status}`;
      log(`API-LOGIN: Login failed - ${errorMsg}`, "error");
      return {
        ok: false,
        message: errorMsg
      };
    } catch (error) {
      const errMsg = error && error.message ? error.message : String(error);
      log(`API-LOGIN: Request failed - ${errMsg}`, "error");
      return {
        ok: false,
        message: errMsg
      };
    }
  }
  async function tokensViaAPI(email, password, twoFactor = null, apiBaseUrl = null) {
    const t0 = process.hrtime.bigint();
    if (!email || !password) {
      return {
        status: false,
        message: "Please provide email and password"
      };
    }
    log(`API-LOGIN: Initialize login ${mask(email, 2)}`, "info");
    const res = await loginViaAPI(email, password, twoFactor, apiBaseUrl);
    if (res && res.ok) {
      log(`API-LOGIN: Login success - UID: ${res.uid}`, "info");
      const t1 = Number(process.hrtime.bigint() - t0) / 1e6;
      log(`Done API login ${Math.round(t1)}ms`, "info");
      return {
        status: true,
        cookies: res.cookies,
        uid: res.uid,
        access_token: res.access_token,
        cookie: res.cookie
      };
    }
    return {
      status: false,
      message: res && res.message ? res.message : "Login failed"
    };
  }
  function normalizeCookieHeaderString(s) {
    let str = String(s || "").trim();
    if (!str) return [];
    if (/^cookie\s*:/i.test(str)) str = str.replace(/^cookie\s*:/i, "").trim();
    str = str.replace(/\r?\n/g, " ").replace(/\s*;\s*/g, ";");
    const parts = str.split(";").map(v => v.trim()).filter(Boolean);
    const out = [];
    for (const p of parts) {
      const eq = p.indexOf("=");
      if (eq <= 0) continue;
      const k = p.slice(0, eq).trim();
      const v = p.slice(eq + 1).trim().replace(/^"(.*)"$/, "$1");
      if (!k) continue;
      out.push(`${k}=${v}`);
    }
    return out;
  }
  function setJarFromPairs(j, pairs, domain) {
    const expires = new Date(Date.now() + 31536e6).toUTCString();
    const urls = ["https://www.facebook.com", "https://facebook.com", "https://m.facebook.com", "http://www.facebook.com", "http://facebook.com", "http://m.facebook.com"];
    for (const kv of pairs) {
      const cookieStr = `${kv}; expires=${expires}; domain=${domain}; path=/;`;
      for (const url of urls) {
        try {
          if (typeof j.setCookieSync === "function") {
            j.setCookieSync(cookieStr, url);
          } else if (typeof j.setCookie === "function") {
            j.setCookie(cookieStr, url);
          }
        } catch {}
      }
    }
  }
  return {
    REGION_MAP,
    parseRegion,
    loginViaAPI,
    tokensViaAPI,
    normalizeCookieHeaderString,
    setJarFromPairs
  };
}
export default {
  createAuthCore,
  DEFAULT_REGIONS
};