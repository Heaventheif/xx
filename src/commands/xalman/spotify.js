"use strict";
import http from "../../utils/fetchHttp.js";

const BASE = "https://xalman-apis.vercel.app/api";

export default {
  config: {
    name: "سبوتيفاي",
    aliases: ["spotify", "spsearch"],
    version: "1.0.0",
    role: 0,
    countDown: 8,
    category: "بحث",
    description: "البحث عن الأغاني في Spotify وإظهار روابطها",
    usage: ["{pn}سبوتيفاي <اسم الأغنية أو الفنان>", "{pn}spotify <كلمات البحث>"],
  },
  onStart: async ({ api, event, args }) => {
    const { threadID, messageID } = event;
    const query = args.join(" ").trim();
    if (!query) return global.safeSend(api, "🎧 اكتب اسم الأغنية أو الفنان، مثال: سبوتيفاي Adele Hello", threadID, null, messageID);
    try {
      const { data } = await http.get(`${BASE}/spotifysearch`, {
        params: { query }, timeout: 30000,
        headers: { "User-Agent": "SunkenBot/Xalman" },
      });
      const results = Array.isArray(data?.results) ? data.results.slice(0, 5) : [];
      if (!results.length) throw new Error("لا توجد نتائج");
      const lines = results.map((item, i) => {
        const title = String(item.title || "بدون عنوان").replace(/\s+/g, " ").slice(0, 80);
        const artist = String(item.artist || "فنان غير معروف").slice(0, 60);
        return `${i + 1}. ${title} — ${artist}\n   ${item.duration || ""}\n   ${item.url || ""}`;
      });
      await global.safeSend(api, `🎧 نتائج Spotify لـ: ${query}\n\n${lines.join("\n\n")}`, threadID, null, messageID);
    } catch (error) {
      await global.safeSend(api, `❌ تعذر البحث في Spotify: ${error.message?.slice(0, 120) || "خطأ غير معروف"}`, threadID, null, messageID);
    }
  },
};

export const $plugin = { name: "xx-commands-xalman-spotify", meta: { category: "command-xalman", path: "src/commands/xalman/spotify.js" }, setup() {} };
