"use strict";

import Tiktok from "@tobyg74/tiktok-api-dl";
import http from "../utils/fetchHttp.js";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { streamAndSend } from "../utils/mediaStream.js";
import { directSend, directSendParts } from "../utils/directSend.js";
import { downloadWithFallback, cleanTemp } from "../utils/ytProviders.js";
import { splitFile, cleanupParts, NEEDS_SPLIT } from "../utils/mediaSplitter.js";

// ── Platform detection ──────────────────────────────────────────────────────
const PLATFORM_MAP = [
  { key: "tiktok",      re: /tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com/i },
  { key: "youtube",     re: /youtube\.com|youtu\.be/i },  // تمت الإضافة
  { key: "instagram",   re: /instagram\.com/i },
  { key: "facebook",    re: /facebook\.com|fb\.watch|fb\.com/i },
  { key: "twitter",     re: /twitter\.com|x\.com|t\.co/i },
  { key: "reddit",      re: /reddit\.com|redd\.it/i },
  { key: "pinterest",   re: /pinterest\.com|pin\.it/i },
  { key: "threads",     re: /threads\.net/i },
  { key: "soundcloud",  re: /soundcloud\.com/i },
  { key: "spotify",     re: /spotify\.com/i },
  { key: "snapchat",    re: /snapchat\.com/i },
  { key: "capcut",      re: /capcut\.com/i },
  { key: "dailymotion", re: /dailymotion\.com/i },
  { key: "bluesky",     re: /bsky\.app|bluesky\.app/i },
  { key: "linkedin",    re: /linkedin\.com/i },
  { key: "tumblr",      re: /tumblr\.com/i },
  { key: "douyin",      re: /douyin\.com/i },
];

const URL_RE = /https?:\/\/[^\s]+/i;
function extractUrl(text) {
  return text?.match(URL_RE)?.[0]?.replace(/[.,)]+$/, "") || null;
}
function detectPlatform(url) {
  return PLATFORM_MAP.find(p => p.re.test(url))?.key || null;
}

// ── دالة مساعدة لإرسال ملف محلي مع دعم التقسيم ──────────────────────────────
async function sendLocalFile(api, threadID, filePath, title, replyToID) {
  try {
    const stat = await fs.stat(filePath);
    const size = stat.size;
    const ext = path.extname(filePath).slice(1) || "mp4";

    if (NEEDS_SPLIT(size)) {
      const parts = await splitFile(filePath, ext);
      const streams = parts.map(p => fs.createReadStream(p));
      const sent = await directSendParts(api, threadID, title, streams, replyToID);
      await cleanupParts(parts);
      return sent > 0;
    } else {
      const ok = await directSend(
        api,
        threadID,
        { body: `📥 ${title || "تم التحميل"}`, attachment: fs.createReadStream(filePath) },
        replyToID
      );
      await fs.remove(filePath).catch(() => {});
      return ok;
    }
  } catch (e) {
    console.error("[SEND_LOCAL] خطأ:", e.message);
    return false;
  }
}

// ── Platform‑specific resolvers ─────────────────────────────────────────────

// TikTok — باستخدام مكتبة @tobyg74/tiktok-api-dl (نفس منطق plugins/tiktok.js)
const TIKTOK_HOSTS = ["www.tiktok.com", "tiktok.com", "vm.tiktok.com", "vt.tiktok.com"];
// ترتيب الإصدارات للمحاولة: v1 يُعطي أغنى بيانات، ثم v3، ثم v2
const TIKTOK_VERSIONS = ["v1", "v3", "v2"];

function validateTikTokUrl(value) {
  let u;
  try { u = new URL(value); } catch {
    throw new Error("الرابط غير صالح (تأكد من صيغته)");
  }
  if (!TIKTOK_HOSTS.includes(u.hostname.toLowerCase())) {
    throw new Error("الرابط يجب أن يكون من TikTok");
  }
}

/**
 * استخراج رابط الفيديو والعنوان من نتيجة المكتبة حسب الإصدار.
 * @returns {{ url: string, title: string, musicUrl?: string }}
 */
function extractTikTokMedia(version, result) {
  if (!result) throw new Error("نتيجة فارغة من المكتبة");

  switch (version) {
    case "v1": {
      const videoUrl =
        result.video?.playAddr?.[0] ||
        result.video?.downloadAddr?.[0];
      if (!videoUrl) throw new Error("لا يوجد رابط فيديو في v1");
      return {
        url: videoUrl,
        title: result.desc || "فيديو تيك توك",
        musicUrl: result.music?.playUrl?.[0],
      };
    }
    case "v2": {
      const videoUrl = result.video?.playAddr;
      if (!videoUrl) throw new Error("لا يوجد رابط فيديو في v2");
      return {
        url: videoUrl,
        title: result.desc || "فيديو تيك توك",
        musicUrl: result.music?.playUrl,
      };
    }
    case "v3": {
      const videoUrl = result.videoHD || result.videoWatermark;
      if (!videoUrl) throw new Error("لا يوجد رابط فيديو في v3");
      return {
        url: videoUrl,
        title: result.desc || "فيديو تيك توك",
        musicUrl: typeof result.music === "string" ? result.music : undefined,
      };
    }
    default:
      throw new Error(`إصدار غير معروف: ${version}`);
  }
}

/**
 * محاولة تحميل بيانات الفيديو عبر إصدار واحد من المكتبة.
 */
async function resolveTikTokWithVersion(tiktokUrl, version) {
  const response = await Tiktok.Downloader(tiktokUrl, { version });

  if (!response || response.status !== "success") {
    throw new Error(response?.message || `فشل الإصدار ${version}`);
  }

  const result = response.result;
  return extractTikTokMedia(version, result);
}

async function resolveTikTok(url) {
  validateTikTokUrl(url);

  const failures = [];
  for (const version of TIKTOK_VERSIONS) {
    try {
      const { url: mediaUrl, title } = await resolveTikTokWithVersion(url, version);
      return { title: title || "فيديو تيك توك", videoUrl: mediaUrl, platform: "tiktok" };
    } catch (error) {
      failures.push(`${version}: ${error.message}`);
    }
  }

  throw new Error(`تعذّر استخراج رابط الفيديو من جميع الإصدارات (${failures.join(" | ")})`);
}

// Instagram — باستخدام smfahim.xyz API
async function resolveInstagram(url) {
  const API_BASE = "https://www.smfahim.xyz/download/instagram/v9";

  const res = await fetch(`${API_BASE}?url=${encodeURIComponent(url)}`, {
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`فشل الاتصال بـ smfahim (HTTP ${res.status})`);

  const json = await res.json();
  if (json?.status === false || json?.success === false) {
    throw new Error(json?.message || "المنشور خاص أو الرابط غير صحيح");
  }

  const extractMedia = (obj) => {
    if (obj?.links && typeof obj.links === "object") {
      const { hd, sd, url, video } = obj.links;
      return hd || sd || url || video;
    }
    const data = obj?.data ?? obj?.result ?? obj;
    const item = Array.isArray(data) ? data[0] : data;
    if (item?.links) {
      const { hd, sd, url } = item.links;
      return hd || sd || url;
    }
    return item?.url || item?.video_url || item?.videoUrl ||
           item?.download_url || item?.downloadUrl || item?.media_url ||
           item?.hd || item?.sd;
  };

  const mediaUrl = extractMedia(json);
  if (!mediaUrl) throw new Error("لم يُعثر على رابط الوسائط");

  const title = json?.title || json?.data?.title || json?.result?.title ||
                (Array.isArray(json?.data) ? json.data[0]?.title : null) ||
                "فيديو انستغرام";

  return { title, videoUrl: mediaUrl, platform: "instagram" };
}

// YouTube — باستخدام ytProviders (مع fallback)
async function resolveYouTube(url) {
  try {
    const result = await downloadWithFallback(url, true); // true = فيديو mp4
    return {
      title: result.title || "YouTube Video",
      filePath: result.filePath,
      platform: "youtube",
      isFile: true,     // علامة للمعالجة اللاحقة
    };
  } catch (e) {
    // إذا فشل الفيديو، نحاول الصوت فقط (اختياري)
    throw new Error(`فشل تحميل يوتيوب: ${e.message}`);
  }
}

// Facebook / Meta (يبقى كما هو)
async function resolveMetaMedia(url) {
  const { data } = await http.get("https://aminul-rest-api-three.vercel.app/downloader/alldownloader", {
    params: { url }, timeout: 30000,
  });
  const info = data?.data?.data || data?.data || data;
  if (!info) throw new Error("Meta: استجابة فارغة");
  const mediaUrl = info.high || info.hd || info.video || info.low || info.sd || info.url;
  return {
    title: info.title || "Meta Media",
    videoUrl: mediaUrl,
    images: info.images || info.photos || null,
    platform: "meta",
  };
}

// Twitter / X — twmate.com
async function resolveTwitter(url) {
  const { data } = await http.post(
    "https://twmate.com/",
    `page=${encodeURIComponent(url)}&ftype=all&ajax=1`,
    {
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
        referer: "https://twmate.com/",
        "user-agent": "Mozilla/5.0",
      },
      timeout: 30000,
    }
  );
  const rows = [...(data || "").matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  const results = rows.map(r => {
    const q = r[1].match(/<td[^>]*>(.*?)<\/td>/i)?.[1]?.trim() || "";
    const link = r[1].match(/href="(https?:\/\/[^"]+)"/i)?.[1] || "";
    return link ? { quality: q, url: link } : null;
  }).filter(Boolean);
  const best = results.find(r => /720|1080|mp4/i.test(r.quality)) || results[0];
  return { title: "Twitter Video", videoUrl: best?.url, platform: "twitter" };
}

// Reddit — submagic API
async function resolveReddit(url) {
  const { data } = await http.post(
    "https://submagic-free-tools.fly.dev/api/reddit-download",
    { url },
    {
      headers: { accept: "*/*", "content-type": "application/json",
        referer: "https://submagic-free-tools.fly.dev/reddit-downloader" },
      timeout: 30000,
    }
  );
  const videoUrl = data?.url || data?.video || data?.high_quality || data?.standard_quality;
  return { title: data?.title || "Reddit Post", videoUrl, platform: "reddit" };
}

// Pinterest — savepin.app
async function resolvePinterest(url) {
  const { data } = await http.get(
    `https://www.savepin.app/download.php?url=${encodeURIComponent(url)}&lang=en&type=redirect`,
    {
      headers: {
        accept: "text/html,application/xhtml+xml,*/*",
        Referer: "https://www.savepin.app/",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/137.0.0.0 Safari/537.36",
      },
      timeout: 30000,
    }
  );
  const linkMatch = (data || "").match(/href="(https:\/\/(?:v\.pinimg\.com|i\.pinimg\.com)[^"]+)"/i);
  const imgMatch  = (data || "").match(/<img[^>]+src="(https:\/\/i\.pinimg\.com\/[^"]+)"/i);
  return {
    title: "Pinterest Media",
    videoUrl: linkMatch?.[1] || null,
    imageUrl: imgMatch?.[1] || null,
    platform: "pinterest",
  };
}

// Threads — threadsv.com
async function resolveThreads(url) {
  const { data } = await http.post(
    "https://threadsv.com/get-thr",
    { token: "29ae809a4f98ebee39d8d683f851fc86", url, lang: "en" },
    {
      headers: {
        "content-type": "application/json",
        referer: "https://threadsv.com/",
        "user-agent": "Mozilla/5.0",
        cookie: "PHPSESSID=l7cec5kqiqlt2mce3q03in0jo9",
      },
      timeout: 30000,
    }
  );
  const html = data?.html || "";
  const linkMatch = html.match(/href="(https:\/\/[^"]+\.mp4[^"]+)"/i);
  return { title: "Threads Video", videoUrl: linkMatch?.[1] || null, platform: "threads" };
}

// SoundCloud — urlmp4.com AIO downloader
async function resolveSoundCloud(url) {
  const { data } = await http.post(
    "https://urlmp4.com/wp-json/aio-dl/video-data/",
    `url=${encodeURIComponent(url)}&token=8b6e170975d92939bb67d8db567f82e43fa2da91e00a84f258af77c1186c5e8a`,
    {
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        Referer: "https://urlmp4.com/en/soundcloud-downloader/",
        "user-agent": "Mozilla/5.0",
        cookie: "pll_language=en",
      },
      timeout: 30000,
    }
  );
  const audioUrl = data?.urls?.[0]?.url || data?.url;
  return { title: data?.title || "SoundCloud Audio", audioUrl, platform: "soundcloud" };
}

// Spotify — spotisongdownloader.to + videosolo
async function resolveSpotify(url) {
  const [r1, r2] = await Promise.allSettled([
    http.get(`https://spotisongdownloader.to/api/composer/spotify/xsingle_track.php?url=${encodeURIComponent(url)}`),
    http.post("https://parsevideoapi.videosolo.com/spotify-api/", { format: "web", url }, {
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        origin: "https://spotidown.online",
        referer: "https://spotidown.online/",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/137.0.0.0 Safari/537.36",
      },
      timeout: 30000,
    }),
  ]);
  const s = r1.status === "fulfilled" ? r1.value?.data : null;
  const v = r2.status === "fulfilled" ? r2.value?.data?.data?.metadata : null;
  const audioUrl = v?.download || s?.downloadlink || null;
  return {
    title:     s?.song_name || v?.name || "Spotify Track",
    artist:    s?.artist    || v?.artist || "",
    thumbnail: s?.img       || v?.image  || null,
    audioUrl,
    platform: "spotify",
  };
}

// Snapchat — solyptube.com
async function resolveSnapchat(url) {
  const { data } = await http.post(
    "https://solyptube.com/findsnapchatvideo",
    { url },
    {
      headers: {
        "content-type": "application/json",
        origin:  "https://spotlight.how2shout.com",
        referer: "https://spotlight.how2shout.com/",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/137.0.0.0 Safari/537.36",
      },
      timeout: 30000,
    }
  );
  const videoUrl = data?.data?.download_url || data?.downloadLink || data?.url;
  return { title: "Snapchat Video", videoUrl, platform: "snapchat" };
}

// CapCut — capcut.download
async function resolveCapCut(url) {
  try {
    const { data } = await http.get(`https://capcut.download/api/download?url=${encodeURIComponent(url)}`, {
      timeout: 30000,
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    return {
      title: data?.title || "CapCut Video",
      videoUrl: data?.video || data?.url,
      platform: "capcut"
    };
  } catch {
    throw new Error("فشل تحميل CapCut");
  }
}

// Dailymotion — dailymotion.com
async function resolveDailymotion(url) {
  const videoId = url.match(/video\/([a-zA-Z0-9]+)/)?.[1];
  if (!videoId) throw new Error("معرف Dailymotion غير صالح");
  const { data } = await http.get(`https://www.dailymotion.com/player/metadata/video/${videoId}`, {
    timeout: 30000,
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  const qualities = ["1080", "720", "480", "360", "240"];
  let videoUrl = null;
  for (const q of qualities) {
    if (data?.qualities?.[q]?.[0]?.url) {
      videoUrl = data.qualities[q][0].url;
      break;
    }
  }
  return {
    title: data?.title || "Dailymotion Video",
    videoUrl: videoUrl || data?.qualities?.["auto"]?.[0]?.url,
    platform: "dailymotion"
  };
}

// Bluesky — bsky.app
async function resolveBluesky(url) {
  const { data } = await http.get(`https://api.bsky.social/xrpc/app.bsky.feed.getPostThread`, {
    params: { uri: url },
    timeout: 30000,
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  const embed = data?.thread?.post?.embed;
  const video = embed?.video || embed?.external?.thumb;
  return {
    title: "Bluesky Post",
    videoUrl: video?.ref?.link || video?.ref || null,
    platform: "bluesky"
  };
}

// Generic fallback — aminul REST API (للمنصات غير المدعومة)
async function resolveGeneric(url) {
  const { data } = await http.get("https://aminul-rest-api-three.vercel.app/downloader/alldownloader", {
    params: { url }, timeout: 40000,
  });
  const info = data?.data?.data || data?.data || data;
  if (!info) throw new Error("Generic: لا يوجد بيانات");
  const mediaUrl = info.high || info.hd || info.video || info.low || info.sd || info.url || info.audio;
  return {
    title: info.title || "وسائط",
    videoUrl: mediaUrl,
    audioUrl: info.audio || null,
    images:   info.images || info.photos || null,
    platform: "generic",
  };
}

// ── Route URL to the correct resolver ────────────────────────────────────────
async function resolveMedia(url) {
  const platform = detectPlatform(url);
  switch (platform) {
    case "tiktok":      return resolveTikTok(url);
    case "youtube":     return resolveYouTube(url);
    case "instagram":   return resolveInstagram(url);
    case "facebook":    return resolveMetaMedia(url);
    case "twitter":     return resolveTwitter(url);
    case "reddit":      return resolveReddit(url);
    case "pinterest":   return resolvePinterest(url);
    case "threads":     return resolveThreads(url);
    case "soundcloud":  return resolveSoundCloud(url);
    case "spotify":     return resolveSpotify(url);
    case "snapchat":    return resolveSnapchat(url);
    case "capcut":      return resolveCapCut(url);
    case "dailymotion": return resolveDailymotion(url);
    case "bluesky":     return resolveBluesky(url);
    default:            return resolveGeneric(url);
  }
}

// ── Download images to temp and return readable streams ───────────────────────
async function downloadImages(urls) {
  const files = await Promise.all(
    urls.map(async (imgUrl, i) => {
      const tmpFile = path.join(os.tmpdir(), `autodl_img_${Date.now()}_${i}.jpg`);
      const res = await http.get(imgUrl, { responseType: "arraybuffer", timeout: 30000 });
      await fs.writeFile(tmpFile, Buffer.from(res.data));
      return tmpFile;
    })
  );
  return files;
}

// ── Unified download + send ───────────────────────────────────────────────────
async function downloadAndSend(api, event, url) {
  const { threadID, messageID } = event;
  try {
    const media = await resolveMedia(url);

    // إذا كانت النتيجة ملفاً محلياً (يوتيوب حالياً)
    if (media.isFile) {
      const ok = await sendLocalFile(api, threadID, media.filePath, media.title, messageID);
      // تنظيف الملف المؤقت (في حال لم يحذفه sendLocalFile)
      await cleanTemp(media.filePath).catch(() => {});
      return ok;
    }

    // صور متعددة (Pinterest, Instagram carousel, etc.)
    if (Array.isArray(media.images) && media.images.length > 0) {
      const files = await downloadImages(media.images);
      await directSend(
        api, threadID,
        { body: `📥 ${media.title}`, attachment: files.map(f => fs.createReadStream(f)) },
        messageID
      );
      await Promise.allSettled(files.map(f => fs.remove(f)));
      return true;
    }

    // صورة واحدة
    if (media.imageUrl && !media.videoUrl && !media.audioUrl) {
      const tmpFile = path.join(os.tmpdir(), `autodl_img_${Date.now()}.jpg`);
      const res = await http.get(media.imageUrl, { responseType: "arraybuffer", timeout: 30000 });
      await fs.writeFile(tmpFile, Buffer.from(res.data));
      await directSend(api, threadID, { body: `📥 ${media.title}`, attachment: fs.createReadStream(tmpFile) }, messageID);
      await fs.remove(tmpFile).catch(() => {});
      return true;
    }

    // صوت (Spotify, SoundCloud)
    if (media.audioUrl && !media.videoUrl) {
      const caption = media.artist
        ? `🎵 ${media.title}\n👤 ${media.artist}`
        : `🎵 ${media.title}`;
      return streamAndSend(api, threadID, media.audioUrl, caption, "mp3", messageID);
    }

    // فيديو (معظم المنصات)
    const videoUrl = media.videoUrl;
    if (!videoUrl) throw new Error("لم يُعثر على رابط تحميل");
    return streamAndSend(api, threadID, videoUrl, media.title || "وسائط", "mp4", messageID);

  } catch (e) {
    console.error(`[AUTODL] ${e.message?.substring(0, 120)}`);
    return false;
  }
}

// ── Platform labels ────────────────────────────────────────────────────────────
const PLATFORM_LABELS = {
  tiktok: "TikTok",
  youtube: "YouTube",
  instagram: "Instagram",
  facebook: "Facebook",
  twitter: "Twitter/X",
  reddit: "Reddit",
  pinterest: "Pinterest",
  threads: "Threads",
  soundcloud: "SoundCloud",
  spotify: "Spotify",
  snapchat: "Snapchat",
  capcut: "CapCut",
  dailymotion: "Dailymotion",
  bluesky: "Bluesky",
  linkedin: "LinkedIn",
  tumblr: "Tumblr",
  douyin: "Douyin",
};

// ── Command export ────────────────────────────────────────────────────────────
export default {
  config: {
    name: "autodl",
    aliases: ["تحميل", "dl", "دونلود"],
    version: "3.1.0",
    role: 0,
    countDown: 8,
    category: "وسائط وتحميل",
    description:
      "تحميل فيديو/صور/صوت من 18 منصة — يوتيوب، تيك توك، إنستغرام، فيسبوك، تويتر، ريديت، بينترست، ثريدز، سناب شات، سبوتيفاي، ساوندكلاود وأكثر.",
    usage: [
      "{pn}autodl <رابط> — تحميل يدوي",
      "أرسل الرابط مباشرة بدون أمر — اكتشاف وتحميل تلقائي",
    ],
    hidden: true,
  },

  // اكتشاف تلقائي للرابط في أي رسالة
  onChat: async ({ api, event }) => {
    const url = extractUrl(event.body) || extractUrl(event.messageReply?.body);
    if (!url || !detectPlatform(url)) return;
    await downloadAndSend(api, event, url);
  },

  // أمر يدوي: .autodl <رابط>
  onStart: async ({ api, event, args, message }) => {
    const url = args[0];
    if (!url) {
      const platforms = Object.values(PLATFORM_LABELS).join(" · ");
      return message.reply(
        "📥 أمر التحميل التلقائي\n\n" +
        "📝 الاستخدام: autodl <رابط>\n\n" +
        "🌐 المنصات المدعومة:\n" + platforms + "\n\n" +
        "💡 أو أرسل الرابط مباشرة بدون أمر!"
      );
    }
    const platform = detectPlatform(url);
    const label = platform ? PLATFORM_LABELS[platform] || platform : "غير محدد";
    const statusMsg = await new Promise((res, rej) =>
      global.safeSend(api, `⏳ جاري التحميل من ${label}...`, event.threadID,
        (e, i) => e ? rej(e) : res(i), event.messageID)
    ).catch(() => null);

    const ok = await downloadAndSend(api, event, url);

    if (statusMsg?.messageID) api.unsendMessage(statusMsg.messageID, event.threadID).catch(() => {});
    if (!ok) message.reply("❌ تعذّر التحميل، تأكد من الرابط أو حاول لاحقاً.");
  },
};