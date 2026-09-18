"use strict";

/**
 * MQTT + session health/metrics helpers.
 * لا يعرض AppState أو cookies أو رموز المصادقة.
 */
import fs from "node:fs";

/**
 * MQTT health snapshot for all bots.
 */
export function getMqttHealthSnapshot(botApis = global.botApis || []) {
  const bots = (Array.isArray(botApis) ? botApis : []).map((api) => ({
    botIndex: api?.__botIndex ?? null,
    name: api?.__botName ?? null,
    mqtt: typeof api?.__mqttManager?.health === "function"
      ? api.__mqttManager.health()
      : api?.__mqttHealth ?? { ok: false, state: "NOT_INITIALIZED" },
  }));

  return {
    ok: bots.length > 0 && bots.every((bot) => bot.mqtt?.ok === true),
    generatedAt: new Date().toISOString(),
    bots,
  };
}

/**
 * [NEW] Session health snapshot.
 * Reports fingerprint age, session file mtime, and whether an encrypted
 * store is present. Never exposes cookie values or tokens.
 */
export function getSessionHealthSnapshot(botApis = global.botApis || []) {
  const bots = (Array.isArray(botApis) ? botApis : []).map((api) => {
    const fp = api?._ctx?._fingerprint || null;
    const mgr = api?._sessionMgr || null;

    // استخرج mtime لملف الجلسة إن وُجد.
    let sessionSavedAt = null;
    let sessionFileBytes = null;
    try {
      const filePath = mgr?.storage?.filePath;
      if (filePath && fs.existsSync(filePath)) {
        const st = fs.statSync(filePath);
        sessionSavedAt = st.mtimeMs;
        sessionFileBytes = st.size;
      }
    } catch (_) {}

    // لا نُعيد أي قيمة من الكوكيز — فقط العمر والحجم والوجود.
    return {
      botIndex: api?.__botIndex ?? null,
      hasSessionManager: !!mgr,
      hasFingerprint:    !!fp,
      fingerprintAgeMs:  fp?.persistedAt ? Date.now() - fp.persistedAt : null,
      fingerprintID:     fp?.sessionId ? String(fp.sessionId).slice(0, 8) : null,
      sessionSavedAt,
      sessionAgeMs:      sessionSavedAt ? Date.now() - sessionSavedAt : null,
      sessionFileBytes,
      // We deliberately do not expose ua / sec-ch-ua / cookies here.
    };
  });

  return {
    ok: bots.every((b) => b.hasSessionManager && b.hasFingerprint),
    generatedAt: new Date().toISOString(),
    bots,
  };
}

/**
 * Express-compatible endpoint registration.
 * Call once after creating the HTTP app:
 * registerMqttHealthEndpoint(app, () => global.botApis)
 */
export function registerMqttHealthEndpoint(app, getApis = () => global.botApis || []) {
  if (!app || typeof app.get !== "function") {
    throw new TypeError("registerMqttHealthEndpoint: app.get is required");
  }

  app.get("/health/mqtt", (_req, res) => {
    const snapshot = getMqttHealthSnapshot(getApis());
    res.status(snapshot.ok ? 200 : 503).json(snapshot);
  });

  app.get("/metrics/mqtt", (_req, res) => {
    const snapshot = getMqttHealthSnapshot(getApis());
    res.type("application/json").send(JSON.stringify(snapshot));
  });

  // [NEW] Session health endpoints.
  app.get("/health/session", (_req, res) => {
    const snapshot = getSessionHealthSnapshot(getApis());
    res.status(snapshot.ok ? 200 : 503).json(snapshot);
  });

  app.get("/metrics/session", (_req, res) => {
    const snapshot = getSessionHealthSnapshot(getApis());
    res.type("application/json").send(JSON.stringify(snapshot));
  });
}

export default {
  getMqttHealthSnapshot,
  getSessionHealthSnapshot,
  registerMqttHealthEndpoint,
};