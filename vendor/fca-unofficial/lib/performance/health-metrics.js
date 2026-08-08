export class HealthMetrics {
  constructor() {
    const now = Date.now();
    this.uptimeStart = now;

    // Connection lifecycle
    this.lastConnectAt = 0;
    this.lastDisconnectAt = 0;
    this.reconnects = 0;
    this.consecutiveFailures = 0;
    this.currentBackoffMs = 0;
    this.maxObservedBackoffMs = 0;

    // Message counters
    this.messagesReceived = 0;
    this.lastMessageAt = 0;
    this.syntheticKeepAlives = 0;

    // Ack latency (EWMA + p95 sample window)
    this.acksReceived = 0;
    this.lastAckLatencyMs = null;
    this.avgAckLatencyMs = null;
    this.p95AckLatencyMs = null;
    /** @type {number[]} */
    this._ackSamples = [];

    // Outbound queue
    this.outboundQueueDepth = 0;
    this.outboundQueueDropped = 0;

    // Delivery
    this.deliveryAttempts = 0;
    this.deliverySuccess = 0;
    this.deliveryFailed = 0;
    this.deliveryTimeouts = 0;

    // Errors
    this.lastErrorAt = 0;
    this.lastErrorType = null;

    // Edit tracking
    this.editResends = 0;
    this.editFailed = 0;
  }

  // ── connection events ─────────────────────────────────────────────────

  onConnect() {
    this.lastConnectAt = Date.now();
    this.consecutiveFailures = 0;
  }
  onDisconnect() {
    this.lastDisconnectAt = Date.now();
  }
  onReconnectScheduled(delayMs) {
    this.reconnects++;
    this.currentBackoffMs = delayMs;
    if (delayMs > this.maxObservedBackoffMs) this.maxObservedBackoffMs = delayMs;
  }
  incFailure() {
    this.consecutiveFailures++;
  }

  // ── message events ────────────────────────────────────────────────────

  onMessage() {
    this.messagesReceived++;
    this.lastMessageAt = Date.now();
  }
  onSynthetic() {
    this.syntheticKeepAlives++;
  }
  onAck(latencyMs) {
    this.acksReceived++;
    if (typeof latencyMs === "number" && Number.isFinite(latencyMs)) {
      this.lastAckLatencyMs = latencyMs;
      this.avgAckLatencyMs = this.avgAckLatencyMs == null ? latencyMs : Math.round(this.avgAckLatencyMs * 0.8 + latencyMs * 0.2);
      this._ackSamples.push(latencyMs);
      if (this._ackSamples.length > 50) this._ackSamples.shift();
      this._recalcP95();
    }
  }
  onError(type) {
    this.lastErrorAt = Date.now();
    this.lastErrorType = type ?? "unknown";
  }

  // ── outbound queue ────────────────────────────────────────────────────

  setQueueDepth(depth) {
    this.outboundQueueDepth = depth;
  }
  incQueueDropped() {
    this.outboundQueueDropped++;
  }

  // ── delivery ──────────────────────────────────────────────────────────

  incDeliveryAttempt() {
    this.deliveryAttempts++;
  }
  incDeliverySuccess() {
    this.deliverySuccess++;
  }
  incDeliveryFailed() {
    this.deliveryFailed++;
  }
  incDeliveryTimeout() {
    this.deliveryTimeouts++;
  }

  // ── summary ───────────────────────────────────────────────────────────

  snapshot() {
    const uptimeSec = Math.floor((Date.now() - this.uptimeStart) / 1000);
    const deliveryRate = this.deliveryAttempts > 0 ? +(this.deliverySuccess / this.deliveryAttempts).toFixed(4) : null;
    return {
      uptimeSec,
      reconnects: this.reconnects,
      consecutiveFailures: this.consecutiveFailures,
      messagesReceived: this.messagesReceived,
      acksReceived: this.acksReceived,
      avgAckLatencyMs: this.avgAckLatencyMs,
      p95AckLatencyMs: this.p95AckLatencyMs,
      outboundQueueDepth: this.outboundQueueDepth,
      outboundQueueDropped: this.outboundQueueDropped,
      deliveryAttempts: this.deliveryAttempts,
      deliverySuccess: this.deliverySuccess,
      deliveryFailed: this.deliveryFailed,
      deliveryRate,
      lastErrorType: this.lastErrorType
    };
  }

  // ── private ───────────────────────────────────────────────────────────

  _recalcP95() {
    if (!this._ackSamples.length) {
      this.p95AckLatencyMs = null;
      return;
    }
    const sorted = [...this._ackSamples].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    this.p95AckLatencyMs = sorted[idx];
  }
}
export function createHealthMetrics() {
  return new HealthMetrics();
}
export default {
  createHealthMetrics,
  HealthMetrics
};