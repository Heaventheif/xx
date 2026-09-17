"use strict";

/**
 * MQTT health/metrics helpers.
 * لا يعرض AppState أو cookies أو رموز المصادقة.
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
}

export default { getMqttHealthSnapshot, registerMqttHealthEndpoint };
