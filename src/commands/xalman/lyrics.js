"use strict";
import http from "../../utils/fetchHttp.js";

const BASE = "https://xalman-apis.vercel.app/api";
const MAX_LYRICS = 3500;

export default {
  config: {
    name: "كلمات",
    aliases: ["lyrics", "كلمات_اغنية"],
    version: "1.0.0",
    role: 0,
    countDown: 10,
    category: "بحث",
    description: "جلب كلمات أغنية عبر Xalman API",
    usage: ["{pn}كلمات <اسم الأغنية>", "{pn}lyrics <اسم الأغنية>"],
  },
  onStart: async ({ api, event, args }) => {
    const { threadID, messageID } = event;
    const song = args.join(" ").trim();
    if (!song) return global.safeSend(api, "🎼 اكتب اسم الأغنية، مثال: كلمات Believer", threadID, null, messageID);
    try {
      const { data } = await http.get(`${BASE}/lyrics`, {
        params: { song }, timeout: 30000,
        headers: { "User-Agent": "SunkenBot/Xalman" },
      });
      const lyrics = data?.data?.lyrics || data?.lyrics;
      if (!lyrics) throw new Error("لم يتم العثور على كلمات");
      const title = data?.data?.title || data?.title || song;
      const artist = data?.data?.artist || data?.artist || "";
      const clipped = String(lyrics).slice(0, MAX_LYRICS);
      const suffix = String(lyrics).length > MAX_LYRICS ? "\n\n… تم اختصار النص لطوله." : "";
      await global.safeSend(api, `🎼 ${title}${artist ? ` — ${artist}` : ""}\n\n${clipped}${suffix}`, threadID, null, messageID);
    } catch (error) {
      await global.safeSend(api, `❌ تعذر جلب الكلمات: ${error.message?.slice(0, 120) || "خطأ غير معروف"}`, threadID, null, messageID);
    }
  },
};

export const $plugin = { name: "xx-commands-xalman-lyrics", meta: { category: "command-xalman", path: "src/commands/xalman/lyrics.js" }, setup() {} };
