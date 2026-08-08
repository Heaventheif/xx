import nodehttp from "node:http";
import logger from "../func/logger.js";
const __importDefault = mod => mod && mod.__esModule ? mod : {
  default: mod
};
const http_1 = __importDefault(nodehttp);
const logger_1 = __importDefault(logger);
const PKG_VERSION = "5.0.0";
export class HealthServer {
  constructor(options = {}) {
    this.options = {
      port: options.port ?? parseInt(process.env.PORT ?? "10000", 10),
      path: options.path ?? "/health",
      // SECURITY (CVE-FCA-06, Low): this used to always call listen(port)
      // with no host, which on most platforms binds every network
      // interface (0.0.0.0) — so on a cloud box with the port exposed, the
      // endpoint (uptime, message/error counters, and the fact that this
      // bot exists and is currently connected) was reachable by anyone on
      // the network, unauthenticated. Default to loopback-only now; pass
      // host: "0.0.0.0" explicitly if you really want it reachable
      // externally (e.g. behind a platform's own load balancer / auth).
      host: options.host ?? "127.0.0.1",
      // Optional shared-secret auth: if set, requests must send
      // `Authorization: Bearer <token>` or get a 401.
      token: options.token ?? null
    };
    this._server = null;
    this._metrics = null; // optional HealthMetrics instance
    this.running = false;
  }

  /** Optionally attach a HealthMetrics instance for richer /health payloads. */
  attachMetrics(metrics) {
    this._metrics = metrics;
    return this;
  }
  start() {
    if (this.running) return;
    this._server = http_1.default.createServer((req, res) => {
      const url = req.url?.split("?")[0] ?? "/";
      if (url !== "/" && url !== this.options.path) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      if (this.options.token) {
        const auth = req.headers["authorization"] || "";
        const ok = auth === `Bearer ${this.options.token}`;
        if (!ok) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "unauthorized" }));
          return;
        }
      }
      const snapshot = this._metrics?.snapshot() ?? null;
      const body = JSON.stringify({
        status: "ok",
        version: PKG_VERSION,
        library: "fca-unofficial",
        uptime: snapshot?.uptimeSec ?? Math.floor(process.uptime()),
        metrics: snapshot
      });
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      });
      res.end(body);
    });
    this._server.on("error", err => {
      logger_1.default(`HealthServer: ${err.message}`, "error");
    });
    this._server.listen(this.options.port, this.options.host, () => {
      logger_1.default(`HealthServer: listening on ${this.options.host}:${this.options.port}`, "info");
      this.running = true;
    });
  }
  stop() {
    if (this._server) {
      this._server.close();
      this.running = false;
    }
  }
}
export function createHealthServer(options) {
  return new HealthServer(options);
}
export default {
  createHealthServer,
  HealthServer
};