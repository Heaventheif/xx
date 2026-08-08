"use strict";

import http from "../utils/fetchHttp.js";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { streamAndSend } from "../utils/mediaStream.js";
import { directSend } from "../utils/directSend.js";

const API_BASE = "https://aminul-rest-api-three.vercel.app";

const LINK_REGEX = /https?:\/\/(www\.)?(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|twitter\.com|x\.com|reddit\.com|pinterest\.com|pin\.it|threads\.net|likee\.video|capcut\.com)\/[^\s]+/i;

const FB_LINK_REGEX = /https?:\/\/(www\.)?(facebook\.com|fb\.watch|fb\.com)\/[^\s]+/i;

// Extract the first supported link from a message body.
function extractLink(text) {
  return text?.match(LINK_REGEX)?.[0] || null;
}

// Ask the all-in-one downloader API to resolve a direct media link.
async function resolveMedia(url) {
  const { data } = await http.get(`${API_BASE}/downloader/alldownloader`, {
    params: { url },
    timeout: 60000,
  });
  const info = data?.data?.data || data?.data || data;
  if (!info) throw new Error("استجابة فارغة من الـ API");
  return info;
}

// حمّل صور متعددة (carousel/gallery) وأرسلها دفعة واحدة مباشرة.
async function downloadImages(urls) {
  const files = await Promise.all(
    urls.map(async (imgUrl, i) => {
      const f = path.join(os.tmpdir(), `autodl_img_${Date.now()}_${i}.jpg`);
      // تحميل الصورة بستريمينغ
      const https = await import("https");
      await new Promise((resolve, reject) => {
        const file = fs.createWriteStream(f);
        https.default.get(imgUrl, (res) => {
          res.pipe(file);
          file.on("finish", () => file.close(resolve));
        }).on("error", reject);
      });
      return f;
    })
  );
  return files;
}

// حلّل وحمّل وأرسل الوسائط لرابط معيّن. يُعيد true عند النجاح.
async function downloadAndSend(api, event, url) {
  const { threadID, messageID } = event;

  try {
    const info = await resolveMedia(url);

    // صور متعددة (carousel/gallery)
    const images = info.images || info.photos;
    if (Array.isArray(images) && images.length > 0) {
      const files = await downloadImages(images);
      await directSend(
        api,
        threadID,
        { body: `📥 ${info.title || "تم التحميل"}`, attachment: files.map((f) => fs.createReadStream(f)) },
        messageID
      );
      await Promise.allSettled(files.map((f) => fs.remove(f)));
      return true;
    }

    // ملف وسائط واحد (فيديو أو صوت)
    const mediaUrl = info.high || info.hd || info.video || info.low || info.sd || info.url || info.audio;
    if (!mediaUrl) throw new Error("لم يُعثر على رابط تحميل صالح");

    const isAudio = /\.(mp3|m4a)(\?|$)/i.test(mediaUrl) || (!info.high && !info.video && info.audio);
    const ext = isAudio ? "mp3" : "mp4";
    const title = info.title || "تم التحميل";

    // تحميل وإرسال بالستريمينغ مع تقسيم تلقائي إن تجاوز 25MB
    return await streamAndSend(api, threadID, mediaUrl, title, ext, messageID);

  } catch (e) {
    console.error("[AUTODL]", e?.response?.status, e.message?.substring(0, 200));
    return false;
  }
}

export default {
  config: {
    name: "autodl",
    aliases: ["تحميل", "دونلود", "dl"],
    version: "2.0.0",
    role: 0,
    countDown: 10, // cooldown بسيط لحماية IP من الحجب على خدمات التحميل الخارجية
    category: "وسائط وتحميل",
    description: "تحميل فيديو/صور من يوتيوب، تيك توك، إنستغرام، تويتر وغيرها — تلقائياً بلا أمر أو يدوياً (روابط فيسبوك: استخدم أمر fb)",
    usage: [
      "{pn}autodl <رابط> — يحمّل الفيديو/الصور من الرابط ويرسلها",
      "أرسل رابط يوتيوب/تيك توك/إنستغرام/تويتر مباشرة بدون أمر — يُكتشف ويُحمَّل تلقائياً",
      "روابط فيسبوك غير مدعومة هنا — استخدم {pn}fb <رابط>",
    ],
    hidden: true,
  },

  // Auto-detect a supported link in any message and download it.
  onChat: async ({ api, event }) => {
    let url = extractLink(event.body);
    if (!url && event.messageReply?.body) url = extractLink(event.messageReply.body);
    if (!url) return;

    await downloadAndSend(api, event, url);
  },

  // Command entry point: download from a link given explicitly.
  onStart: async ({ api, event, args, message }) => {
    const urlArg = args[0];
    if (!urlArg) {
      return message.reply(
        "📥 التحميل التلقائي\n\n" +
        "📝 الاستخدام: autodl <رابط>\n" +
        "🌐 المنصات المدعومة: يوتيوب، تيك توك، إنستغرام، تويتر/X، ريديت، بينترست، ثريدز\n\n" +
        "💡 أو أرسل الرابط مباشرة بدون أمر وسيُكتشف تلقائياً!"
      );
    }

    const url = extractLink(urlArg) || urlArg;
    if (FB_LINK_REGEX.test(url)) {
      return message.reply("ℹ️ روابط فيسبوك لها أمر خاص، استخدم: fb <رابط>");
    }
    const ok = await downloadAndSend(api, event, url);
    if (!ok) return message.reply("❌ تعذّر تحميل الوسائط من هذا الرابط، تأكد من صحته أو حاول لاحقاً.");
  },
};
