"use strict";

import fs from "fs-extra";
import os from "os";
import path from "path";
import https from "https";
import http from "http";
import { splitFile, cleanupParts, NEEDS_SPLIT } from "./mediaSplitter.js";
import { directSend, directSendParts } from "./directSend.js";


// GET request that follows redirects and returns an IncomingMessage stream.
function fetchStream(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error("تجاوز الحد الأقصى لإعادة التوجيه"));
    const isHttps = url.startsWith("https");
    const lib = isHttps ? https : http;
    lib.get(url, { timeout: 120000 }, (res) => {
      const { statusCode, headers } = res;
      if (statusCode === 301 || statusCode === 302 || statusCode === 307 || statusCode === 308) {
        res.resume(); // استنزف الجسم لإتاحة الاتصال
        const location = headers.location;
        if (!location) return reject(new Error("إعادة توجيه بدون Location header"));
        return fetchStream(location, redirectCount + 1).then(resolve).catch(reject);
      }
      if (statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${statusCode} من الخادم`));
      }
      resolve({ stream: res, contentLength: parseInt(headers["content-length"] || "0", 10) });
    }).on("error", reject)
      .on("timeout", function() { this.destroy(new Error("انتهت مهلة الاتصال")); });
  });
}

// Download a file to a temp path and return the path and actual byte size.
async function downloadToTemp(url, ext = "mp4") {
  const { stream, contentLength } = await fetchStream(url);
  const tmpPath = path.join(os.tmpdir(), `media_${Date.now()}.${ext}`);
  const writer = fs.createWriteStream(tmpPath);

  await new Promise((resolve, reject) => {
    stream.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
    stream.on("error", reject);
  });

  // استخدم الحجم الفعلي من القرص (أدق من Content-Length)
  const stat = await fs.stat(tmpPath);
  return { tmpPath, size: stat.size, contentLength };
}

// Download and send a media file with streaming and auto-split support.
// Returns true when the full send succeeds.
async function streamAndSend(api, threadID, mediaUrl, title, ext = "mp4", replyToID = undefined) {
  let tmpPath;
  let partPaths = [];

  try {
    // تحميل الملف إلى القرص أولاً (ستريمينغ التحميل)
    const { tmpPath: downloaded, size } = await downloadToTemp(mediaUrl, ext);
    tmpPath = downloaded;

    console.log(`[MEDIA_STREAM] تم تحميل ${Math.round(size / 1024 / 1024 * 10) / 10}MB (${ext})`);

    if (NEEDS_SPLIT(size)) {
      // ملف كبير — قسّمه وأرسل الأجزاء بالترتيب
      partPaths = await splitFile(tmpPath, ext);
      const streams = partPaths.map(p => fs.createReadStream(p));
      const sent = await directSendParts(api, threadID, title, streams, replyToID);
      return sent > 0;
    } else {
      // ملف عادي — إرسال مباشر
      const ok = await directSend(
        api,
        threadID,
        { body: `📥 ${title || "تم التحميل"}`, attachment: fs.createReadStream(tmpPath) },
        replyToID
      );
      return ok;
    }
  } catch (e) {
    console.error("[MEDIA_STREAM] خطأ:", e.message?.substring(0, 200));
    if (e.code === "FILE_TOO_LARGE") {
      await global.safeSend(api, `⚠️ ${e.message}`, threadID, null, replyToID).catch(() => {});
      return true; // handled — caller shouldn't also show the generic failure message
    }
    return false;
  } finally {
    // تنظيف: احذف الملف الأصلي والأجزاء
    if (tmpPath) fs.remove(tmpPath).catch(() => {});
    if (partPaths.length > 0) cleanupParts(partPaths).catch(() => {});
  }
}

export { streamAndSend, downloadToTemp, fetchStream };
