import http from "../../utils/fetchHttp.js";
import fs from "fs";
import path from "path";
import os from "os";
const TUMBLR_API_KEY = process.env.TUMBLR_API_KEY || "";
const _RECENTLY_SENT_KEY = "random_recentlySent";
const _recentlySent = new Set();
const _RECENT_LIMIT = 200;
let _hydrated = false;
function hydrateRecentlySent() {
  if (_hydrated) return;
  _hydrated = true;
  const saved = global.globalData?.get?.(_RECENTLY_SENT_KEY);
  if (Array.isArray(saved)) for (const key of saved) _recentlySent.add(key);
}
function rememberSent(key) {
  if (!key) return;
  _recentlySent.add(key);
  if (_recentlySent.size > _RECENT_LIMIT) {
    _recentlySent.delete(_recentlySent.values().next().value);
  }
  global.globalData?.set?.(_RECENTLY_SENT_KEY, [..._recentlySent]);
}
const VIDEO_BLOGS = [
  "videohall", "gifak-net", "sizvideos", "pleatedjeans",
  "tastefullyoffensive", "humortrain", "best-of-tumblr-daily",
  "videogifs", "funnyordie", "motionaddicts",
  "catasters", "kittens", "there-is-always-hope",
  "awesome-picz", "thefrogman",
];
async function tryTumblr() {
  if (!TUMBLR_API_KEY) return null;
  const shuffled = [...VIDEO_BLOGS].sort(() => Math.random() - 0.5);
  for (const blog of shuffled) {
    try {
      const countResp = await http.get(
        `https://api.tumblr.com/v2/blog/${blog}/posts/video`,
        { params: { api_key: TUMBLR_API_KEY, limit: 1 }, timeout: 8000 }
      );
      const totalPosts = countResp.data?.response?.total_posts || 20;
      const maxOffset  = Math.max(0, totalPosts - 20);
      const offset     = Math.floor(Math.random() * (maxOffset + 1));
      const response = await http.get(
        `https://api.tumblr.com/v2/blog/${blog}/posts/video`,
        { params: { api_key: TUMBLR_API_KEY, limit: 20, offset }, timeout: 8000 }
      );
      const posts = response.data?.response?.posts || [];
      if (!posts.length) continue;
      const fresh = posts.filter(p => !_recentlySent.has(p.post_url));
      const pool  = fresh.length ? fresh : posts;
      const post  = pool[Math.floor(Math.random() * pool.length)];
      const url = post.video_url
        || post.player?.find(p => p.width >= 400)?.embed_code
        || post.player?.[0]?.embed_code;
      if (!url || !url.startsWith("http")) continue;
      return {
        source: "tumblr",
        videoUrl: url,
        sentKey: post.post_url || "",
        label: `📺 @${blog}`,
        caption: (post.summary || post.caption || "").replace(/<[^>]*>/g, "").trim().substring(0, 100),
        footerLink: post.post_url || "",
      };
    } catch (_) { continue; }
  }
  return null;
}
export default {
  config: {
    name: "random",
    aliases: ["فيديو"],
    version: "1.5.0",
    countDown: 15,
    role: 0,
    category: "وسائط وتحميل",
    description: "فيديو عشوائي من Tumblr — قائمة التكرار محفوظة في MongoDB",
    usage: [
      "{pn}فيديو — فيديو عشوائي من Tumblr",
    ],
  },
  onStart: async function ({ api, event, args }) {
    const { threadID, messageID } = event;
    hydrateRecentlySent();
    if (!TUMBLR_API_KEY) {
      return global.safeSend(api, "⚠️ لا يوجد أي مصدر مضبوط (TUMBLR_API_KEY)", threadID, null, messageID);
    }
    const tmpFile = path.join(os.tmpdir(), `random_${Date.now()}.mp4`);
    try {
      const picked = await tryTumblr();
      if (!picked) {
        return global.safeSend(api, "❌ لم أجد فيديو الآن — حاول مرة أخرى", threadID, null, messageID);
      }
      const { videoUrl, sentKey, label, caption, footerLink } = picked;
      const dlResponse = await http.get(videoUrl, {
        responseType: "stream", timeout: 60000,
        headers: { "User-Agent": "Mozilla/5.0" },
        validateStatus: () => true,
      });
      if (dlResponse.status !== 200) {
        rememberSent(sentKey);
        return global.safeSend(api, 
          `🎬 ${caption || "فيديو عشوائي"}\n${label}\n\n🔗 ${footerLink}`,
          threadID, null, messageID
        );
      }
      await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(tmpFile);
        dlResponse.data.pipe(writer);
        writer.on("finish", resolve);
        writer.on("error", reject);
      });
      const sizeMB = fs.statSync(tmpFile).size / (1024 * 1024);
      if (sizeMB < 0.01) {
        return global.safeSend(api, "❌ الفيديو فارغ — حاول مرة أخرى", threadID, null, messageID);
      }
      if (sizeMB > 25) {
        rememberSent(sentKey);
        return global.safeSend(api, 
          `🎬 ${caption || "فيديو عشوائي"}\n${label}\n💾 ${sizeMB.toFixed(1)}MB\n\n🔗 ${footerLink}`,
          threadID, null, messageID
        );
      }
      await new Promise((resolve, reject) =>
        global.safeSend(api, 
          { body: `🎬 ${caption || "فيديو عشوائي"}\n${label}`, attachment: fs.createReadStream(tmpFile) },
          threadID, (err) => err ? reject(err) : resolve(), messageID
        )
      );
      rememberSent(sentKey);
    } catch (error) {
      let errMsg = "❌ فشل جلب الفيديو\n";
      if (error.response?.status === 401)     errMsg += "🔑 API Key غير صالح";
      else if (error.response?.status === 429) errMsg += "⚠️ تجاوزت حد الطلبات";
      else if (error.code === "ECONNABORTED")  errMsg += "⏱ انتهت مهلة الانتظار";
      else errMsg += error.message?.substring(0, 150) || "خطأ غير معروف";
      global.safeSend(api, errMsg, threadID, null, messageID);
    } finally {
      try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (_) {}
    }
  }
};
