"use strict";
import http from "../../utils/fetchHttp.js";
import fs from "fs-extra";
import os from "os";
import path from "path";

const BASE = "https://xalman-apis.vercel.app/api";
const HEADERS = { "User-Agent": "SunkenBot/Xalman" };

async function searchSpotify(query) {
  const { data } = await http.get(`${BASE}/spotifysearch`, {
    params: { query }, timeout: 30000, headers: HEADERS,
  });
  const results = Array.isArray(data?.results) ? data.results : [];
  if (!results.length) throw new Error("لا توجد نتائج في Spotify");
  return results;
}

async function findYoutubeTrack(title, artist) {
  const search = `${title} ${artist || ""}`.trim();
  const { data } = await http.get(`${BASE}/ytsearch`, {
    params: { q: search }, timeout: 30000, headers: HEADERS,
  });
  const results = Array.isArray(data?.results) ? data.results : [];
  const match = results.find((item) => item?.url) || null;
  if (!match) throw new Error("لم أعثر على نسخة YouTube للأغنية");
  return match;
}

async function downloadAudio(youtubeUrl) {
  const { data } = await http.get(`${BASE}/ytmp3`, {
    params: { url: youtubeUrl }, timeout: 60000, headers: HEADERS,
  });
  if (!data?.success || !data?.url) {
    throw new Error(data?.message || "فشل إنشاء رابط الصوت");
  }
  return data;
}

async function downloadFileInRanges(url, destination) {
  const chunkSize = 1000000;
  let start = 0;
  let total = null;
  await fs.remove(destination).catch(() => {});
  while (total === null || start < total) {
    const end = total === null ? start + chunkSize - 1 : Math.min(start + chunkSize - 1, total - 1);
    let response = null;
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        response = await http.get(url, {
          responseType: "arraybuffer", timeout: 45000,
          headers: { ...HEADERS, Range: `bytes=${start}-${end}` },
        });
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
    if (!response) throw lastError || new Error("فشل تنزيل جزء الصوت");
    const buffer = Buffer.from(response.data);
    if (!buffer.length) throw new Error("استلمت جزءًا فارغًا من ملف الصوت");
    await fs.appendFile(destination, buffer);
    const range = response.headers?.["content-range"] || "";
    const match = range.match(/bytes\s+\d+-\d+\/(\d+)/i);
    if (match) total = Number(match[1]);
    if (response.status === 200 || !match) break;
    start += buffer.length;
    if (buffer.length < chunkSize && total === null) break;
  }
  const stat = await fs.stat(destination);
  if (!stat.size) throw new Error("ملف الصوت الناتج فارغ");
}

export default {
  config: {
    name: "سبوتيفاي",
    aliases: ["spotify", "spsearch", "اغنية", "أغنية"],
    version: "2.0.0",
    role: 0,
    countDown: 15,
    category: "وسائط وتحميل",
    description: "البحث عن أغنية وإرسالها كملف صوتي",
    usage: [
      "{pn}سبوتيفاي <اسم الأغنية أو الفنان> — إرسال MP3",
      "{pn}spotify <اسم الأغنية أو الفنان>",
    ],
  },
  onStart: async ({ api, event, args }) => {
    const { threadID, messageID } = event;
    const query = args.join(" ").trim();
    if (!query) return global.safeSend(api, "🎧 اكتب اسم الأغنية أو الفنان، مثال: سبوتيفاي Adele Hello", threadID, null, messageID);

    let filePath = null;
    try {
      await global.safeSend(api, "🔎 أبحث عن الأغنية ثم أجهز الملف الصوتي...", threadID, null, messageID);
      const tracks = await searchSpotify(query);
      const track = tracks[0];
      const title = track.title || query;
      const artist = track.artist || "";
      const youtube = await findYoutubeTrack(title, artist);
      const audio = await downloadAudio(youtube.url);

      const safeName = `${title} - ${artist}`.replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 80) || "spotify-song";
      filePath = path.join(os.tmpdir(), `sunken_${Date.now()}.mp3`);
      await downloadFileInRanges(audio.url, filePath);

      await new Promise((resolve, reject) => {
        global.safeSend(api, {
          body: `🎵 ${title}${artist ? `\n👤 ${artist}` : ""}\n🔊 MP3 — ${audio.quality || "128kbps"}`,
          attachment: fs.createReadStream(filePath),
        }, threadID, (err) => err ? reject(err) : resolve(), messageID);
      });
    } catch (error) {
      console.error("[spotify]", error.message);
      await global.safeSend(api, "⚠️ تعذر إرسال الملف الصوتي الآن.\nيمكنك تجربة البحث مرة أخرى لاحقًا.", threadID, null, messageID);
    } finally {
      if (filePath) await fs.remove(filePath).catch(() => {});
    }
  },
};

export const $plugin = { name: "xx-commands-xalman-spotify", meta: { category: "command-xalman", path: "src/commands/xalman/spotify.js" }, setup() {} };
