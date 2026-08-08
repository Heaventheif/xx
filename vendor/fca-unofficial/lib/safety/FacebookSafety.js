import fs from "fs";
import path from "path";

export default class FacebookSafety {
  constructor(options = {}) {
    this.options = {
      enableSafeHeaders: true, enableHumanBehavior: true, enableAntiDetection: true,
      enableAutoRefresh: true, enableLoginValidation: true, enableSafeDelays: true,
      bypassRegionLock: true, ultraLowBanMode: true, enableUAContinuity: true, ...options,
    };
    this._fixedUA = null;
    this.safeUserAgents = ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"];
    this.regions = ["ASH","ATL","DFW","ORD","PHX","SJC","IAD"];
    this.currentRegion = this.regions[Math.floor(Math.random() * this.regions.length)];
    this.humanDelayPatterns = {
      typing:{min:800,max:2500}, reading:{min:1500,max:5000},
      thinking:{min:1500,max:6000}, browsing:{min:1000,max:3000}, messageDelay:{min:1500,max:4000},
    };
    this.sessionMetrics = { requestCount:0, errorCount:0, lastActivity:Date.now(), riskLevel:"low" };
    this._lastEventTs = Date.now();
    this._reconnecting = false; this._activeListenerStop = null;
    this._backoff = {attempt:0,next:0}; this._destroyed = false;
    this._inFlightRefreshId = 0; this._probing = false; this._ghostChecking = false;
    this._lastRefreshTs = 0; this._lastRecycleTs = 0; this._lastLightPokeTs = 0;
    this._timerRegistry = new Set(); this._minSpacingMs = 45*60*1000;
    this._lastHeavyMaintenanceTs = 0; this._adaptivePacingWindowMs = 2*60*1000;
    this._postRefreshChecks = []; this._refreshing = false;
    this.safetyStorePath = path.join(process.cwd(), ".fca-safety-store.json");
    this._init();
  }

  _init() {
    if (this.options.enableAutoRefresh) this._setupSafeRefresh();
    this._loadFromSafetyStore();
    this._setupSessionMonitoring();
    this._schedulePeriodicRecycle();
    this._scheduleLightPoke();
    this._scheduleSessionBreath();
  }

  setFixedUserAgent(ua) { if (ua && typeof ua === "string") this._fixedUA = ua; }

  getSafeUserAgent() {
    if (this.options.enableUAContinuity) {
      if (!this._fixedUA) this._fixedUA = this.safeUserAgents[0];
      return this._fixedUA;
    }
    return this.safeUserAgents[0];
  }

  applySafeHeaders(h = {}) {
    const headers = {
      "User-Agent": this.getSafeUserAgent(),
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5", "DNT": "1",
      "Connection": "keep-alive", "Cache-Control": "max-age=0", ...h,
    };
    const region = (this.ctx && this.ctx.region) || (this.options.bypassRegionLock && this.currentRegion);
    if (region) headers["X-MSGR-Region"] = region;
    return headers;
  }

  getHumanDelay(action = "browsing") {
    if (!this.options.enableSafeDelays) return 5000;
    const p = this.humanDelayPatterns[action] || this.humanDelayPatterns.browsing;
    const base = Math.random() * (p.max - p.min) + p.min;
    const jitter = Math.random() * 2000;
    const mult = this.sessionMetrics.riskLevel === "high" ? 2.5 : this.sessionMetrics.riskLevel === "medium" ? 1.8 : 1.3;
    return Math.max(3000, Math.floor((base + jitter) * mult));
  }

  validateLogin(appState) {
    try {
      if (!appState) return { safe: false, reason: "No appState" };
      const p = typeof appState === "string" ? JSON.parse(appState) : appState;
      if (!p.length) return { safe: false, reason: "Empty appState" };
      const hasEssential = p.some(c => ["c_user", "xs", "datr", "sb"].includes(c.name || c.key));
      return hasEssential ? { safe: true, reason: "Validated" } : { safe: false, reason: "Missing essential cookies" };
    } catch (e) { return { safe: false, reason: e.message }; }
  }

  checkErrorSafety(error) {
    const dangerous = ["checkpoint","verification_required","account_locked","temporarily_blocked","unusual_activity","security_check","login_approval","account_suspended"];
    const text = (error.message || String(error)).toLowerCase();
    for (const p of dangerous) { if (text.includes(p)) return { safe: false, danger: p, recommendation: "Stop all operations immediately" }; }
    return { safe: true, danger: null };
  }

  recordRequest(isError = false) {
    this.sessionMetrics.requestCount++;
    this.sessionMetrics.lastActivity = Date.now();
    if (isError) this.sessionMetrics.errorCount++;
    this._lastEventTs = Date.now();
  }

  recordEvent() { this._lastEventTs = Date.now(); }

  _setupSafeRefresh() {
    const schedule = () => {
      if (this._destroyed) return;
      const risk = this.sessionMetrics.riskLevel;
      const [minMs, maxMs] = risk === "high" ? [7200000, 10800000] : risk === "medium" ? [5400000, 9000000] : [3000000, 5400000];
      const t = setTimeout(async () => { await this.refreshSafeSession(); schedule(); }, minMs + Math.random() * (maxMs - minMs));
      this._registerTimer(t);
    };
    schedule();
  }

  _setupSessionMonitoring() {
    const t = setInterval(() => this._updateRiskLevel(), 60000);
    this._registerTimer(t);
  }

  _updateRiskLevel() {
    const errorRate = this.sessionMetrics.errorCount / Math.max(1, this.sessionMetrics.requestCount);
    const next = errorRate > 0.3 ? "high" : errorRate > 0.1 ? "medium" : "low";
    if (next !== this.sessionMetrics.riskLevel) {
      this.sessionMetrics.riskLevel = next;
      this._onRiskLevelChanged(next);
    }
  }

  _onRiskLevelChanged(risk) {
    this._minSpacingMs = risk === "high" ? 1800000 : 2700000;
    this._safetyEmit("riskLevelChanged", { risk });
  }

  async _ensureMqttAlive() {
    if (!this.api || this._destroyed) return;
    try {
      const disconnected = !this.ctx?.mqttClient?.connected;
      const idle = Date.now() - this._lastEventTs;
      if (disconnected || idle > 480000) { await this._reconnectMqttWithBackoff(disconnected ? "disconnected" : "hard-stale"); return; }
      if (idle > 150000 && !this._probing) {
        this._probing = true;
        const prevTs = this._lastEventTs;
        try { if (this.ctx.mqttClient.ping) this.ctx.mqttClient.ping(); } catch (_) {}
        setTimeout(() => {
          if (!this._destroyed && this._lastEventTs <= prevTs) { this._backoff.attempt = 0; this._reconnectMqttWithBackoff("soft-stale"); }
          this._probing = false;
        }, 7000);
      }
    } catch (_) {}
  }

  async _reconnectMqttWithBackoff(reason) {
    if (this._reconnecting || this._destroyed) return;
    this._reconnecting = true;
    try {
      const now = Date.now();
      if (now < this._backoff.next) return;
      const attempt = ++this._backoff.attempt;
      const base = this.sessionMetrics.riskLevel === "high" ? 900 : 1500;
      const delay = Math.min(25000, base * Math.pow(1.9, Math.min(attempt, 6))) + Math.random() * 600;
      this._backoff.next = now + delay;
      await new Promise(r => setTimeout(r, delay));
      if (this._activeListenerStop) { try { this._activeListenerStop(); } catch (_) {} }
      if (this.api && typeof this.api.listenMqtt === "function" && !this._destroyed) {
        const stop = this.api.listenMqtt((err, event) => { if (!err && event) this.recordEvent(); });
        this._activeListenerStop = stop;
        this._markHeavyMaintenance();
        this._safetyEmit("mqttReconnect", { success: true, reason, attempt });
      }
      setTimeout(() => { if (this.ctx?.mqttClient?.connected) this._backoff.attempt = 0; }, 5000);
    } catch (e) {
      this._safetyEmit("mqttReconnect", { success: false, error: e.message, reason });
    } finally { this._reconnecting = false; }
  }

  forceReconnect(tag = "manual") {
    if (this._destroyed) return;
    this._backoff.attempt = 0;
    return this._reconnectMqttWithBackoff("force-" + tag);
  }

  _schedulePeriodicRecycle() {
    if (this._destroyed) return;
    const delay = 21600000 + (Math.random() * 60 - 30) * 60000;
    const t = setTimeout(() => {
      if (this._destroyed) return;
      if (Date.now() - this._lastRefreshTs < this._minSpacingMs) {
        const dt = setTimeout(() => this._schedulePeriodicRecycle(), 1200000 + Math.random() * 600000);
        this._registerTimer(dt); return;
      }
      this._lastRecycleTs = Date.now();
      this.forceReconnect("periodic");
      this._schedulePeriodicRecycle();
    }, delay);
    this._registerTimer(t);
  }

  _scheduleLightPoke() {
    if (this._lightPokeTimer || this._destroyed) return;
    const schedule = () => {
      if (this._destroyed) return;
      const t = setTimeout(async () => {
        if (this._destroyed) return;
        if (Date.now() - this._lastRefreshTs >= this._minSpacingMs / 2) {
          try {
            if (this.api && typeof this.api.refreshFb_dtsg === "function") {
              await this.api.refreshFb_dtsg().catch(() => {});
              this._lastRefreshTs = Date.now();
              this._safetyEmit("lightPoke", { ts: Date.now() });
            }
          } catch (_) {}
        }
        schedule();
      }, 1800000 + (Math.random() * 20 - 10) * 60000);
      this._registerTimer(t);
      this._lightPokeTimer = t;
    };
    schedule();
  }

  _scheduleSessionBreath() {
    if (this._breathTimer || this._destroyed) return;
    const schedule = () => {
      if (this._destroyed) return;
      const t = setTimeout(() => {
        if (!this._destroyed) this._safetyEmit("sessionBreath", { ts: Date.now() });
        schedule();
      }, 1200000 + Math.random() * 300000);
      this._registerTimer(t);
      this._breathTimer = t;
    };
    schedule();
  }

  startMonitoring(ctx, api) {
    if (!ctx || !api) return;
    this.ctx = ctx; this.api = api;
    if (this._monitorInterval) clearInterval(this._monitorInterval);
    this._monitorInterval = setInterval(() => {
      try {
        const cookies = this.ctx?.jar?.getCookies?.("https://www.facebook.com") || [];
        if (!cookies.find(c => c.key === "c_user"))
          this._safetyEmit("accountIssue", { type: "session_expired", message: "c_user cookie missing" });
      } catch (_) {}
    }, 30000);
    this.recordEvent();
    this._startDynamicHeartbeat();
  }

  _startDynamicHeartbeat() {
    if (this._heartbeatInterval) clearInterval(this._heartbeatInterval);
    if (this._destroyed) return;
    const ms = this.sessionMetrics.riskLevel === "high" ? 55000 : 80000;
    this._heartbeatInterval = setInterval(() => {
      if (this._destroyed) return;
      try { if (this.ctx?.mqttClient?.connected && this.ctx.mqttClient.ping) this.ctx.mqttClient.ping(); } catch (_) {}
      if (Date.now() - this._lastEventTs > (this.sessionMetrics.riskLevel === "high" ? 480000 : 720000)) {
        this._backoff.attempt = 0; this._ensureMqttAlive();
      }
    }, ms + Math.random() * 20000);
    this._registerTimer(this._heartbeatInterval);
  }

  async refreshSafeSession() {
    if (this._refreshing || Date.now() - this._lastRefreshTs < this._minSpacingMs / 2) return;
    this._refreshing = true;
    const refreshId = ++this._inFlightRefreshId;
    try {
      if (!this.api || typeof this.api.refreshFb_dtsg !== "function") return;
      await this.api.refreshFb_dtsg();
      this._saveToSafetyStore();
      this.sessionMetrics.lastActivity = Date.now();
      this._lastRefreshTs = Date.now();
      this._markHeavyMaintenance();
      this._safetyEmit("safeRefresh", { ok: true });
      await this._ensureMqttAlive();
      [1000, 10000, 30000].forEach(d => {
        const h = setTimeout(() => { if (!this._destroyed && refreshId === this._inFlightRefreshId) this._ensureMqttAlive(); }, d);
        this._postRefreshChecks.push(h);
      });
    } catch (e) {
      this.recordRequest(true);
      this._safetyEmit("safeRefresh", { ok: false, error: e.message });
      this._backoff.attempt = 0;
      await this._ensureMqttAlive();
    } finally { this._refreshing = false; }
  }

  computeAdaptiveSendDelay() {
    const risk = this.sessionMetrics.riskLevel;
    const inWindow = Date.now() - this._lastHeavyMaintenanceTs < this._adaptivePacingWindowMs;
    const [min, max] = risk === "high" ? [3500, 6500] : risk === "medium" ? [2000, 4500] : inWindow ? [1500, 3000] : [1000, 2500];
    return Math.floor(min + Math.random() * (max - min));
  }

  async applyAdaptiveSendDelay() { return new Promise(r => setTimeout(r, this.computeAdaptiveSendDelay())); }

  getSafetyRecommendations() {
    const r = [];
    if (this.sessionMetrics.riskLevel === "high") r.push("Reduce request frequency", "Add longer delays between messages");
    if (this.sessionMetrics.errorCount > 5) r.push("Check account manually in browser", "Consider using a fresh appState");
    return r;
  }

  setSafetyEventHandler(fn) { this.onSafetyEvent = fn; }
  _safetyEmit(event, data) { if (typeof this.onSafetyEvent === "function") try { this.onSafetyEvent(event, data); } catch (_) {} }
  _registerTimer(t) { if (t) this._timerRegistry.add(t); }
  _markHeavyMaintenance() { this._lastHeavyMaintenanceTs = Date.now(); }

  _saveToSafetyStore() {
    if (!this.ctx?.fb_dtsg) return;
    try {
      const d = { fb_dtsg: this.ctx.fb_dtsg, jazoest: this.ctx.jazoest, updatedAt: new Date().toISOString() };
      const dir = path.dirname(this.safetyStorePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      // SECURITY: fb_dtsg/jazoest are session tokens — restrict to owner-only.
      fs.writeFileSync(this.safetyStorePath, JSON.stringify(d, null, 2), { encoding: "utf8", mode: 0o600 });
    } catch (_) {}
  }

  _loadFromSafetyStore() {
    try {
      if (fs.existsSync(this.safetyStorePath)) {
        const d = JSON.parse(fs.readFileSync(this.safetyStorePath, "utf8"));
        if (d.fb_dtsg && this.ctx && !this.ctx.fb_dtsg) { this.ctx.fb_dtsg = d.fb_dtsg; this.ctx.jazoest = d.jazoest; }
      }
    } catch (_) {}
  }

  destroy() {
    this._destroyed = true;
    this._timerRegistry.forEach(t => { try { clearTimeout(t); clearInterval(t); } catch (_) {} });
    this._timerRegistry.clear();
    this._postRefreshChecks.forEach(h => clearTimeout(h));
    this._postRefreshChecks = [];
    if (this._activeListenerStop) { try { this._activeListenerStop(); } catch (_) {} }
    if (this._monitorInterval) clearInterval(this._monitorInterval);
    if (this._heartbeatInterval) clearInterval(this._heartbeatInterval);
  }
}
