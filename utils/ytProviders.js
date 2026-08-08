"use strict";

// Three independent YouTube search/download backends. Each exposes the same
// shape — search(query, limit) and download(url, wantMp4) — so the caller
// (cmds/yt.js) can try them in order and fall through automatically if one
// backend is down or rate-limited.

import fs from "fs-extra";
import os from "os";
import path from "path";
import http from "./fetchHttp";
import { searchVideos, downloadAudio, downloadVideo } from "./ytEngine";

const MAX_FILE_BYTES = 26214400; // 25MB — Facebook attachment ceiling

async function streamToTempFile(url, prefix, ext) {
  const filePath = path.join(os.tmpdir(), `${prefix}_${Date.now()}.${ext}`);
  const response = await http.get(url, { responseType: "stream", timeout: 120000 });

  const writer = fs.createWriteStream(filePath);
  response.data.pipe(writer);
  await new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });

  const stat = await fs.stat(filePath);
  if (stat.size === 0) { await fs.remove(filePath).catch(() => {}); throw new Error("الملف فارغ."); }
  if (stat.size > MAX_FILE_BYTES) { await fs.remove(filePath).catch(() => {}); throw new Error("الملف أكبر من 25MB."); }

  return filePath;
}

// Provider 1: local engine — no external HTTP dependency, tried first.
const engineProvider = {
  name: "engine",
  async search(query, limit) {
    const results = await searchVideos(query, limit);
    if (!results?.length) throw new Error("لا توجد نتائج");
    return results;
  },
  async download(url, wantMp4) {
    const dl = wantMp4 ? await downloadVideo(url) : await downloadAudio(url);
    return {
      filePath: dl.filePath,
      title: dl.title || "media",
      duration: dl.duration || 0,
      uploader: dl.uploader || "",
    };
  },
};

// Provider 2: yt-dlp-stream.onrender.com — external API, tried second.
const YT_DLP_STREAM_BASE = "https://yt-dlp-stream.onrender.com/api";

function parseYtDlpStreamResult(d) {
  if (!d || typeof d !== "object") return { title: "بدون عنوان", author: "", mp4Url: null, mp3Url: null };
  const m = (d.media && typeof d.media === "object" && !Array.isArray(d.media)) ? d.media : {};
  const getUrl = (f) => (typeof f === "string" ? f : (f && typeof f.url === "string" ? f.url : null));
  return {
    title: d.title || "بدون عنوان",
    author: d.author || d.channel || "",
    mp4Url: getUrl(m.mp4) || getUrl(d.mp4) || null,
    mp3Url: getUrl(m.mp3) || getUrl(d.mp3) || null,
  };
}

const ytDlpStreamProvider = {
  name: "yt-dlp-stream",
  async search(query, limit) {
    const url = `${YT_DLP_STREAM_BASE}/v3/q?=${encodeURIComponent(query)}&?=${limit}`;
    const res = await http.get(url, { timeout: 25000 });
    const data = res.data;
    const list = Array.isArray(data) ? data
      : Array.isArray(data?.results) ? data.results
      : Array.isArray(data?.data) ? data.data
      : [];
    if (!list.length) throw new Error("لا توجد نتائج");
    return list.map(v => ({ ...v, url: v.url || v.short_url }));
  },
  async download(url, wantMp4) {
    const resolveUrl = `${YT_DLP_STREAM_BASE}/v2/q?=${encodeURIComponent(url)}`;
    const res = await http.get(resolveUrl, { timeout: 30000 });
    const raw = Array.isArray(res.data) ? res.data[0] : res.data;
    const parsed = parseYtDlpStreamResult(raw || {});
    const mediaUrl = wantMp4 ? parsed.mp4Url : parsed.mp3Url;
    if (!mediaUrl) throw new Error("الرابط غير متاح عبر هذا المزوّد");

    const filePath = await streamToTempFile(mediaUrl, "yt2", wantMp4 ? "mp4" : "mp3");
    return { filePath, title: parsed.title, duration: 0, uploader: parsed.author };
  },
};

// Provider 3: ccproject.serv00.net — external API, tried last.
const CCPROJECT_BASE = "https://ccproject.serv00.net/ytdl2.php";

const ccProjectProvider = {
  name: "ccproject",
  search: (query, limit) => ytDlpStreamProvider.search(query, limit),
  async download(url, wantMp4) {
    const type = wantMp4 ? "mp4" : "mp3";
    const res = await http.get(CCPROJECT_BASE, { params: { url, type }, timeout: 30000 });
    const data = res.data;
    if (!data || typeof data !== "object") throw new Error("استجابة غير متوقعة من الـ API الخارجي");
    if (!data.download) throw new Error(data.error || "لم يُرجع الـ API رابط تحميل");

    const filePath = await streamToTempFile(data.download, "ydl", type);
    return { filePath, title: data.title || "بدون عنوان", duration: 0, uploader: "" };
  },
};

export const providers = [engineProvider, ytDlpStreamProvider, ccProjectProvider];

// Try each provider's search sequentially (first success wins).
// Search is lightweight so sequential is fine — avoids hammering all APIs at once.
export async function searchWithFallback(query, limit) {
  const errors = [];
  const tried = new Set();
  for (const provider of providers) {
    if (tried.has(provider.search)) continue;
    tried.add(provider.search);
    try {
      return await provider.search(query, limit);
    } catch (e) {
      errors.push(`${provider.name}: ${e.message}`);
    }
  }
  throw new Error(errors.join(" | ") || "تعذّر البحث عبر جميع المزوّدين");
}

// Race all providers simultaneously for downloads — return the fastest success.
// If all fail, throw a combined error.
export async function downloadWithFallback(url, wantMp4) {
  const attempts = providers.map(async (provider) => {
    const result = await provider.download(url, wantMp4);
    return { ...result, provider: provider.name };
  });

  // Promise.any: resolves with the first fulfillment, rejects only if all fail.
  try {
    return await Promise.any(attempts);
  } catch (aggErr) {
    // AggregateError — collect individual messages
    const msgs = aggErr.errors?.map((e, i) => `${providers[i]?.name ?? i}: ${e.message}`).join(" | ")
      || "تعذّر التحميل عبر جميع المزوّدين";
    throw new Error(msgs);
  }
}

// Delete a temporary downloaded file.
export async function cleanTemp(filePath) {
  try { if (filePath && await fs.pathExists(filePath)) await fs.remove(filePath); } catch (_) {}
}
