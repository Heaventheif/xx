"use strict";

/**
 * E2EEBridge — مجسر E2EE لـ fca-main
 * ─────────────────────────────────────────────────────────────────────────────
 * يستخدم محرك Signal Protocol / Noise WebSocket المُجمَّع في:
 *   ./vendor/fb-e2ee.cjs
 *
 * FIXES مُطبَّقة:
 *  FIX #4 — global._nexcaE2EEAdapter: استُبدل بـ WeakMap لتجنب race condition
 *            في بيئات multi-account/multi-bot.
 *  FIX #5 — _streamToBuffer: يتحقق من نوع المدخل (Buffer/string/Stream)
 *            قبل محاولة استدعاء .on() لتجنب crash على مدخلات غير stream.
 *  FIX #6 — fetch fallback: فحص صريح لوجود fetch (Node >=18) قبل استخدامه،
 *            مع رسالة خطأ واضحة على Node الأقدم.
 *  FIX #7 — إضافة تعليق توضيحي لـ replyDM / senderID كـ threadID في DM.
 */

const path = require("path");
const logger = require("../utils/nexca-logger");
// bridge.js is CommonJS; resolve the optional MIME package once, safely.
let mime = null;
try { mime = require("mime"); } catch (_) { /* fallback MIME map is used below */ }

// ── FIX #4: WeakMap بدلاً من global ─────────────────────────────────────────
// يربط كل FBClient instance بالـ adapter الخاص به بدون تلوث global scope.
const _adapterMap = new WeakMap();

function loadFBClient() {
    try {
        const vendorPath = path.join(__dirname, "vendor", "fb-e2ee.cjs");
        return require(vendorPath).FBClient;
    } catch (err) {
        throw new Error(
            "E2EE engine failed to load (fb-e2ee.cjs).\n" +
            "  Expected at: lib/e2ee/vendor/fb-e2ee.cjs\n" +
            "  Cause: " + err.message
        );
    }
}

class E2EEBridge {
    constructor(ctx, api) {
        this.ctx = ctx;
        this.api = api;
        this.client = null;
        this.connected = false;
        this._messageCallback = null;
        this._connectPromise = null;
        this._resyncPromise = null;
        this._lastResyncAt = 0;
    }

    isConnected() {
        return this.connected && !!this.client;
    }

    onMessage(callback) {
        this._messageCallback = callback;
    }

    async connect(deviceStorePath, userId) {
        if (this.connected && this.client) return { userId: this.ctx.userID };
        if (this._connectPromise) return this._connectPromise;

        this._connectPromise = this._doConnect(deviceStorePath, userId)
            .catch((err) => { this._connectPromise = null; throw err; });
        return this._connectPromise;
    }

    async _doConnect(deviceStorePath, userId) {
        const fs = require("fs");
        userId = userId || this.ctx.userID;

        if (!deviceStorePath) {
            deviceStorePath = path.join(process.cwd(), ".fca_e2ee", "device.json");
        }
        try { fs.mkdirSync(path.dirname(deviceStorePath), { recursive: true }); } catch (_) {}

        logger.info("E2EE", "Device store: " + deviceStorePath);

        const FBClient = loadFBClient();
        const _api = this.api;
        this.client = new FBClient({ platform: "facebook" });

        // Reuse the API already authenticated by Client.js.
        // Do not call FBClient.connect() here: that method expects an appState
        // config and would perform a second Facebook login.
        if (!this.client.controller) {
            throw new Error("E2EE engine has no ClientController");
        }
        const ctx = this.ctx;
        const gatewayApi = new Proxy(_api, {
            get(target, property, receiver) {
                if (property === "fb_dtsg") return ctx.fb_dtsg || target.fb_dtsg;
                if (property === "httpPost") {
                    return async (url, form) => {
                        if (typeof target._defaultFuncs?.post === "function") {
                            return target._defaultFuncs.post(url, ctx.jar, form);
                        }
                        if (typeof fetch !== "function") throw new Error("No HTTP client available for E2EE CAT request");
                        const cookies = target.getAppState?.() || [];
                        const cookieHeader = cookies.map((cookie) => `${cookie.key}=${cookie.value}`).join("; ");
                        const response = await fetch(url, {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/x-www-form-urlencoded",
                                ...(cookieHeader ? { Cookie: cookieHeader } : {})
                            },
                            body: new URLSearchParams(form).toString()
                        });
                        return response.text();
                    };
                }
                return Reflect.get(target, property, receiver);
            }
        });
        this.client.controller.api = gatewayApi;
        this.client.controller.userId = String(userId || _api.getCurrentUserID?.() || "");
        const resolvedUserId = this.client.controller.userId;

        logger.info("E2EE", "Opening Noise WebSocket (Signal Protocol)...");
        const _e2eeDevicePath = deviceStorePath;
        const _e2eeUserId = resolvedUserId || userId;
        await this.client.connectE2EE(_e2eeDevicePath, _e2eeUserId);

        // ── إعادة اتصال تلقائية ─────────────────────────────────────────────
        const _self = this;
        this.client.onEvent("disconnected", function _onDisconnected() {
            if (!_self.connected) return;
            logger.warn("E2EE", "Noise WebSocket disconnected — reconnecting in 5s...");
            setTimeout(async () => {
                if (!_self.connected) return;
                try {
                    await _self.client.connectE2EE(_e2eeDevicePath, _e2eeUserId);
                    logger.success("E2EE", "E2EE WebSocket reconnected.");
                } catch (err) {
                    logger.error("E2EE", "E2EE reconnect failed: " + (err && err.message ? err.message : String(err)));
                }
            }, 5000);
        });

        // ── استقبال الرسائل المشفرة ─────────────────────────────────────────
        this.client.onEvent("e2ee_message", (msg) => {
            const failure = msg?.type === "decryption_failed" || msg?.data?.type === "decryption_failed";
            if (failure) {
                void this.requestKeyResync("decryption_failed");
                return;
            }
            if (!this._messageCallback) return;

            const senderID = msg.senderId ||
                (typeof msg.senderJid === "string" ? msg.senderJid.split(".")[0] : "");

            let mentions = {};
            if (Array.isArray(msg.mentions)) {
                msg.mentions.forEach((m) => { if (m && m.id) mentions[m.id] = m.text || "@" + m.id; });
            } else if (msg.mentions && typeof msg.mentions === "object") {
                mentions = msg.mentions;
            }

            const isReply = !!(msg.replyTo && msg.replyTo.messageId);
            const event = {
                type:        isReply ? "message_reply" : "message",
                senderID,
                threadID:    msg.threadId,
                body:        msg.text || "",
                isE2EE:      true,
                isGroup:     !!msg.isGroup,
                timestamp:   msg.timestampMs || Date.now(),
                messageID:   msg.id || "",
                attachments: [],
                mentions,
                args:        (msg.text || "").trim().split(/\s+/).filter(Boolean),
            };

            // تعبئة ctx.threadTypes لكي يعمل sendMessage بشكل صحيح مع DM
            // FIX #7: هذا صحيح — في DM المشفرة msg.threadId هو الـ thread (ليس senderID)
            // replyDM يستخدم senderID كـ threadID لأن في DM العلاقة 1:1
            if (!event.isGroup && msg.threadId) {
                this.ctx.threadTypes = this.ctx.threadTypes || {};
                this.ctx.threadTypes[String(msg.threadId)] = "dm";
            }

            if (isReply) {
                event.messageReply = {
                    messageID: msg.replyTo.messageId,
                    senderID:  msg.replyTo.senderId || "",
                    threadID:  msg.threadId,
                    body:      msg.replyTo.text || "",
                    args:      (msg.replyTo.text || "").trim().split(/\s+/).filter(Boolean),
                    isE2EE:    true,
                    isGroup:   !!msg.isGroup,
                    mentions:  {},
                    attachments: []
                };
            }

            this._messageCallback(null, event);
        });

        this.client.onEvent("error", (err) => {
            if (err && (err.code === 1 || (err.message && err.message.includes("old counter")))) return;
            logger.error("E2EE", "E2EE error: " + (err && err.message ? err.message : String(err)));
        });

        this.connected = true;
        this._connectPromise = null;
        logger.success("E2EE", "E2EE active — Signal Protocol / Noise WebSocket ready");
        return { userId: resolvedUserId || userId };
    }

    /** إرسال رسالة نصية (أو مع مرفقات) عبر Noise WebSocket */
    async sendMessage(threadId, msg, replyToMessageId) {
        this._ensureConnected();
        const text = typeof msg === "string" ? msg : (msg && msg.body != null ? String(msg.body) : "");
        const attachment = msg && typeof msg === "object" ? (msg.attachment || null) : null;

        if (!attachment) {
            return this.client.sendMessage({ threadId, text, replyToMessageId });
        }

        // إرسال مع مرفقات
        const list = Array.isArray(attachment) ? attachment : [attachment];
        const results = [];
        for (const stream of list) {
            // ── FIX #5: تحقق من نوع المرفق قبل استدعاء _streamToBuffer ───────
            const data = await _toBuffer(stream);
            const fileName = (stream && stream.path
                ? path.basename(String(stream.path))
                : "file.bin");
            const mimeType = (mime && mime.getType(fileName)) || _guessMime(fileName);
            const input = { threadId, data, fileName, mimeType, caption: text || undefined, replyToMessageId };
            let result;
            if (mimeType.startsWith("image/"))       result = await this.client.sendImage(input);
            else if (mimeType.startsWith("video/"))  result = await this.client.sendVideo(input);
            else if (mimeType.startsWith("audio/"))  result = await this.client.sendAudio(input);
            else                                      result = await this.client.sendFile(input);
            results.push(result);
        }
        return results.length === 1 ? results[0] : results;
    }

    async sendReaction(threadId, messageId, reaction, senderJid) {
        this._ensureConnected();
        return this.client.sendReaction({ threadId, messageId, reaction, senderJid });
    }

    async sendTyping(threadId, isTyping) {
        this._ensureConnected();
        return this.client.sendTyping({ threadId, isTyping: isTyping !== false });
    }

    async unsendMessage(messageId, threadId) {
        this._ensureConnected();
        return this.client.unsendMessage({ messageId, threadId });
    }

    async editMessage(threadId, messageId, newText) {
        this._ensureConnected();
        return this.client.editMessage({ threadId, messageId, newText });
    }

    async requestKeyResync(reason = "unknown") {
        if (this._resyncPromise) return this._resyncPromise;
        const now = Date.now();
        if (now - this._lastResyncAt < 30_000) {
            logger.debug("E2EE", `Key resync suppressed during cooldown (${reason})`);
            return false;
        }
        const maintenance = this.client?.controller?.preKeyMaintenance;
        if (!maintenance || typeof maintenance.sync !== "function") {
            logger.warn("E2EE", `Key resync unavailable (${reason}); keeping the session alive.`);
            return false;
        }
        this._lastResyncAt = now;
        this._resyncPromise = Promise.resolve()
            .then(() => maintenance.sync(`bridge:${reason}`))
            .then(() => true)
            .catch((error) => {
                logger.warn("E2EE", `Key resync failed (${reason}): ${error?.message || String(error)}`);
                return false;
            })
            .finally(() => { this._resyncPromise = null; });
        return this._resyncPromise;
    }

    async disconnect() {
        if (this.client) {
            try { await this.client.disconnect(); } catch (_) {}
        }
        this.connected = false;
        logger.info("E2EE", "E2EE disconnected.");
    }

    _ensureConnected() {
        if (!this.connected || !this.client) {
            throw new Error("E2EE bridge not connected. Call connectE2EE() first.");
        }
    }
}

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * FIX #5 — تحويل أي مدخل (Stream / Buffer / string) إلى Buffer
 */
function _toBuffer(input) {
    if (Buffer.isBuffer(input)) return Promise.resolve(input);
    if (typeof input === "string") return Promise.resolve(Buffer.from(input, "utf8"));
    if (input && typeof input.on === "function") {
        // ReadableStream
        return new Promise((resolve, reject) => {
            const chunks = [];
            input.on("data", (c) => chunks.push(c));
            input.on("end",  () => resolve(Buffer.concat(chunks)));
            input.on("error", reject);
        });
    }
    return Promise.reject(new TypeError(
        "[E2EEBridge] sendMessage attachment must be a Buffer, string, or Readable stream. " +
        "Got: " + (input === null ? "null" : typeof input)
    ));
}

function _guessMime(fileName) {
    const ext = (fileName || "").split(".").pop().toLowerCase();
    const map = {
        jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
        gif: "image/gif", webp: "image/webp",
        mp4: "video/mp4", mov: "video/quicktime",
        mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav",
        m4a: "audio/mp4", aac: "audio/aac",
        pdf: "application/pdf", zip: "application/zip"
    };
    return map[ext] || "application/octet-stream";
}

module.exports = { E2EEBridge };
