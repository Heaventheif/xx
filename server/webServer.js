"use strict";

import fs from "fs-extra";
import express from "express";
import https from "https";
import http from "http";
import chalk from "chalk";
import { searchVideos, downloadAudio, downloadVideo } from "../utils/ytEngine";

// Start the small HTTP server used for health checks/keep-alive/YouTube routes.
function startWebServer() {
  const PORT = parseInt(process.env.PORT || "10000");
  const app = express();

  app.get("/", (_req, res) => {
    res.send(`
      <!DOCTYPE html><html lang="ar" dir="rtl">
      <head><meta charset="UTF-8"><title>${global.config.botName}</title></head>
      <body style="font-family:sans-serif;padding:30px;background:#0d1117;color:#c9d1d9">
        <h2>🤖 ${global.config.botName}</h2>
        <p>الحالة: <b style="color:#3fb950">✅ يعمل</b></p>
        <p>⏱️ Uptime: ${Math.floor(process.uptime())} ثانية</p>
        <p>📦 الأوامر: ${global.commands.size}</p>
        <p>🔗 البوت: ${global.botApi ? "متصل" : "جاري الاتصال..."}</p>
      </body></html>
    `);
  });

  app.get("/health", healthHandler);
  app.get("/api/health", healthHandler);

  function healthHandler(_req, res) {
    res.json({
      status: "ok",
      bot: global.botApi ? "connected" : "connecting",
      commands: global.commands.size,
      uptime: Math.floor(process.uptime()),
      memory: `${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`,
      timestamp: new Date().toISOString(),
    });
  }

  (() => {
    app.use(express.json());

    app.post("/yt/search", async (req, res) => {
      try {
        const query = (req.body?.query || "").trim();
        const limit = Math.min(parseInt(req.body?.limit || 10), 15);
        if (!query) return res.status(400).json({ error: "query مطلوب" });

        const results = await searchVideos(query, limit);
        res.json({ results });
      } catch (e) {
        console.error("[YT/search]", e.message);
        res.status(500).json({ error: e.message?.slice(0, 300) });
      }
    });

    app.post("/yt/audio", async (req, res) => {
      const url = (req.body?.url || "").trim();
      if (!url) return res.status(400).json({ error: "url مطلوب" });
      let tmpPath = null;
      try {
        const dl = await downloadAudio(url);
        tmpPath = dl.filePath;

        res.set({
          "Content-Type": "audio/mpeg",
          "Content-Disposition": `attachment; filename="${encodeURIComponent(dl.title)}.mp3"`,
          "X-Title": encodeURIComponent(dl.title),
          "X-Duration": String(dl.duration),
          "X-Uploader": encodeURIComponent(dl.uploader),
        });
        const stream = fs.createReadStream(tmpPath);
        stream.on("end", () => fs.remove(tmpPath).catch(() => {}));
        stream.on("error", () => fs.remove(tmpPath).catch(() => {}));
        stream.pipe(res);
      } catch (e) {
        if (tmpPath) fs.remove(tmpPath).catch(() => {});
        console.error("[YT/audio]", e.message);
        res.status(500).json({ error: e.message?.slice(0, 300) });
      }
    });

    app.post("/yt/video", async (req, res) => {
      const url = (req.body?.url || "").trim();
      if (!url) return res.status(400).json({ error: "url مطلوب" });
      let tmpPath = null;
      try {
        const dl = await downloadVideo(url);
        tmpPath = dl.filePath;

        res.set({
          "Content-Type": "video/mp4",
          "Content-Disposition": `attachment; filename="${encodeURIComponent(dl.title)}.mp4"`,
          "X-Title": encodeURIComponent(dl.title),
          "X-Duration": String(dl.duration),
          "X-Uploader": encodeURIComponent(dl.uploader),
        });
        const stream = fs.createReadStream(tmpPath);
        stream.on("end", () => fs.remove(tmpPath).catch(() => {}));
        stream.on("error", () => fs.remove(tmpPath).catch(() => {}));
        stream.pipe(res);
      } catch (e) {
        if (tmpPath) fs.remove(tmpPath).catch(() => {});
        console.error("[YT/video]", e.message);
        res.status(500).json({ error: e.message?.slice(0, 300) });
      }
    });

    console.log(chalk.green("[SUCCESS] 🎵 YouTube routes جاهزة (/yt/search, /yt/audio, /yt/video)"));
  })();

  app.listen(PORT, () => {
    console.log(chalk.green(`[SUCCESS] 🌐 Web server على المنفذ ${PORT}`));
  });

  global.expressApp = app;

  const externalUrl = process.env.RENDER_EXTERNAL_URL;
  if (externalUrl) {
    setInterval(() => {
      const url = externalUrl.replace(/\/$/, "") + "/health";
      const mod = url.startsWith("https") ? https : http;
      const req = mod.get(url, (r) => {
        r.resume();
        if (r.statusCode !== 200) console.warn("[KEEP-ALIVE] ⚠️ status:", r.statusCode);
      });
      req.on("error", (e) => console.warn("[KEEP-ALIVE] ⚠️ خطأ:", e.message));
      req.setTimeout(20000, () => req.destroy());
    }, 10 * 60 * 1000);
    console.log(chalk.cyan(`[KEEP-ALIVE] ✅ بنغ ذاتي مفعّل لـ ${externalUrl}`));
  } else {
    console.warn(chalk.yellow("[KEEP-ALIVE] ⚠️ RENDER_EXTERNAL_URL غير مضبوط — البوت قد ينام بعد 15 دقيقة خمول (Free Plan)"));
  }

  const hfBaseForPing = (process.env.HF_SPACE_URL || "").trim().replace(/\/+$/, "");
  if (hfBaseForPing) {
    setInterval(() => {
      const url = hfBaseForPing + "/ping";
      const mod = url.startsWith("https") ? https : http;
      const req = mod.get(url, (r) => {
        r.resume();
        if (r.statusCode !== 200) console.warn("[KEEP-ALIVE:HF] ⚠️ status:", r.statusCode);
      });
      req.on("error", (e) => console.warn("[KEEP-ALIVE:HF] ⚠️ خطأ:", e.message));
      req.setTimeout(20000, () => req.destroy());
    }, 5 * 60 * 1000);
    console.log(chalk.cyan(`[KEEP-ALIVE:HF] ✅ بنغ ذاتي مفعّل لـ ${hfBaseForPing}`));
  } else {
    console.warn(chalk.yellow("[KEEP-ALIVE:HF] ⚠️ HF_SPACE_URL غير مضبوط — لن يتم إبقاء HF Space صاحياً"));
  }
}

export { startWebServer };
