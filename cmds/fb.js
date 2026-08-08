"use strict";

import fs from "fs-extra";
import os from "os";
import path from "path";
import http from "../utils/fetchHttp.js";
import { getHfBase, getInternalToken } from "../utils/hfClient.js";

import { splitFile, cleanupParts, NEEDS_SPLIT } from "../utils/mediaSplitter.js";
import { directSend, directSendParts } from "../utils/directSend.js";

const FB_REGEX = /https?:\/\/(www\.)?(facebook\.com|fb\.watch|fb\.com)\/(watch|share|reel|video|reels|[\w.]+\/videos?|[\w.]+\/reels?)[^\s]*/i;

// Extract a Facebook video URL from a message body.
function extractFbUrl(text) {
  return text?.match(FB_REGEX)?.[0] || null;
}

// Resolve a downloadable video link for a Facebook post.
async function fetchFbVideo(fbUrl, quality) {
  const { data } = await http.post(
    `${getHfBase()}/fb`,
    { url: fbUrl, quality },
    { timeout: 120000, headers: { "Content-Type": "application/json", "X-Internal-Token": getInternalToken() } }
  );
  if (!data?.video_b64) throw new Error(data?.error || "استجابة فارغة");
  return data;
}

// Download a Facebook video and send it with automatic split support for large files.
async function downloadAndSend(api, event, fbUrl, quality = "worst", label = "") {
  const { threadID } = event;
  let tmpFile;
  let partPaths = [];

  try {
    const { video_b64, title } = await fetchFbVideo(fbUrl, quality);
    const buffer = Buffer.from(video_b64, "base64");
    const videoTitle = `${title || "فيديو فيسبوك"}${label}`.trim();

    tmpFile = path.join(os.tmpdir(), `fb_${Date.now()}.mp4`);
    await fs.writeFile(tmpFile, buffer);

    const size = buffer.length;
    console.log(`[FB] تم تحميل ${Math.round(size / 1024 / 1024 * 10) / 10}MB`);

    if (NEEDS_SPLIT(size)) {
      // فيديو كبير — قسّمه وأرسل الأجزاء بالترتيب مباشرة
      partPaths = await splitFile(tmpFile, "mp4");
      const streams = partPaths.map(p => fs.createReadStream(p));
      const sent = await directSendParts(api, threadID, videoTitle, streams);
      return sent > 0;
    } else {
      // فيديو عادي — إرسال مباشر بدون طابور
      return await directSend(
        api,
        threadID,
        { body: `🎬 ${videoTitle}`, attachment: fs.createReadStream(tmpFile) }
      );
    }

  } catch (e) {
    console.error("[FB→HF]", e.response?.status, e.message?.substring(0, 200));
    console.error("[fb:downloadAndSend]", e.message);
    if (e.code === "FILE_TOO_LARGE") {
      await global.safeSend(api, `⚠️ ${e.message}`, threadID, null, event.messageID);
      return true; // handled — caller shouldn't also show the generic failure message
    }
    return false;
  } finally {
    if (tmpFile) fs.remove(tmpFile).catch(() => {});
    if (partPaths.length > 0) cleanupParts(partPaths).catch(() => {});
  }
}

export default {
  config: {
    name:      "fb",
    aliases:   ["فيسبوك"],
    version:   "6.0.0",
    role:      0,
    countDown: 10, // cooldown بسيط لحماية IP من الحجب على خدمات التحميل الخارجية
    category: "وسائط وتحميل",
    description: "تحميل فيديو من فيسبوك (أو كشفه تلقائياً من رابط بلا أمر) — مع تقسيم تلقائي للفيديوهات الكبيرة",
    usage: [
      "{pn}فيسبوك <رابط فيسبوك> — تحميل بجودة عادية",
      "{pn}فيسبوك hd <رابط فيسبوك> — تحميل بجودة HD",
      "أرسل رابط فيسبوك مباشرة بدون أمر — يُكتشف ويُحمَّل تلقائياً",
    ],
    hidden: true,
  },

  // Auto-detect a Facebook video link in any message and download it.
  onChat: async ({ api, event }) => {
    let fbUrl = null;
    for (const att of (event.attachments || [])) {
      if (att.type === "share" && att.url) { fbUrl = att.url; break; }
    }
    if (!fbUrl) fbUrl = extractFbUrl(event.body);
    if (!fbUrl && event.messageReply?.body) fbUrl = extractFbUrl(event.messageReply.body);
    if (!fbUrl) return;

    await downloadAndSend(api, event, fbUrl, "worst");
  },

  // Command entry point: download a Facebook video from a given URL.
  onStart: async ({ api, event, args, message }) => {
    if (!args[0]) return message.reply(
      "📥 فيسبوك دونلودر\n\n" +
      ".fb <رابط>      — تحميل عادي\n" +
      ".fb hd <رابط>  — جودة HD\n\n" +
      "💡 أو أرسل رابط فيسبوك مباشرة بدون أمر!\n" +
      "📦 الفيديوهات الكبيرة (+25MB) تُرسل كأجزاء مرتبة تلقائياً"
    );
    const wantHD  = args[0].toLowerCase() === "hd";
    const urlArg  = wantHD ? args[1] : args[0];
    const quality = wantHD ? "720p" : "worst";
    if (!urlArg) return message.reply("❌ أرسل الرابط بعد hd.");
    const fbUrl = extractFbUrl(urlArg) || urlArg;

    const ok = await downloadAndSend(api, event, fbUrl, quality, wantHD ? " · HD" : "");
    if (!ok) throw new Error("فشل تحميل الفيديو من فيسبوك (تحقق من الرابط أو حاول لاحقاً)");
  },
};
