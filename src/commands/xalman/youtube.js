"use strict";
import http from "../../utils/fetchHttp.js";

const BASE = "https://xalman-apis.vercel.app/api";

export default {
  config: {
    name: "يوتيوب",
    aliases: ["ytsearch", "يوت"],
    version: "1.0.0",
    role: 0,
    countDown: 8,
    category: "بحث",
    description: "البحث عن فيديوهات يوتيوب وإظهار الروابط",
    usage: ["{pn}يوتيوب <كلمات البحث>", "{pn}ytsearch <كلمات البحث>"],
  },
  onStart: async ({ api, event, args }) => {
    const { threadID, messageID } = event;
    const query = args.join(" ").trim();
    if (!query) return global.safeSend(api, "🔎 اكتب كلمات البحث، مثال: يوتيوب موسيقى هادئة", threadID, null, messageID);
    try {
      const { data } = await http.get(`${BASE}/ytsearch`, {
        params: { q: query }, timeout: 30000,
        headers: { "User-Agent": "SunkenBot/Xalman" },
      });
      const results = Array.isArray(data?.results) ? data.results.slice(0, 7) : [];
      if (!results.length) throw new Error("لا توجد نتائج");
      const lines = results.map((item, i) => {
        const title = String(item.title || "بدون عنوان").replace(/\s+/g, " ").slice(0, 100);
        return `${i + 1}. ${title}\n   ${item.duration || ""} — ${item.url || ""}`;
      });
      await global.safeSend(api, `🔎 نتائج يوتيوب لـ: ${query}\n\n${lines.join("\n\n")}`, threadID, null, messageID);
    } catch (error) {
      await global.safeSend(api, `❌ تعذر البحث في يوتيوب: ${error.message?.slice(0, 120) || "خطأ غير معروف"}`, threadID, null, messageID);
    }
  },
};

export const $plugin = { name: "xx-commands-xalman-youtube", meta: { category: "command-xalman", path: "src/commands/xalman/youtube.js" }, setup() {} };
