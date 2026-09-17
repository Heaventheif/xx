"use strict";
import http from "../../utils/fetchHttp.js";

const BASE = "https://xalman-apis.vercel.app/api";

export default {
  config: {
    name: "xgpt",
    aliases: ["xai", "سؤال", "سوال"],
    version: "1.0.0",
    role: 0,
    countDown: 8,
    category: "ذكاء اصطناعي",
    description: "إجابة سريعة عبر Xalman GPT",
    usage: ["{pn}xgpt <سؤالك>", "{pn}سؤال <سؤالك>"],
  },
  onStart: async ({ api, event, args }) => {
    const { threadID, messageID } = event;
    const question = args.join(" ").trim();
    if (!question) return global.safeSend(api, "✍️ اكتب سؤالك بعد الأمر، مثال: xgpt ما هي عاصمة اليابان؟", threadID, null, messageID);
    try {
      const { data } = await http.get(`${BASE}/gpt`, {
        params: { q: question }, timeout: 30000,
        headers: { "User-Agent": "SunkenBot/Xalman" },
      });
      const answer = data?.message || data?.answer || data?.response;
      if (!answer) throw new Error("استجابة فارغة");
      await global.safeSend(api, `🤖 ${answer}`, threadID, null, messageID);
    } catch (error) {
      await global.safeSend(api, `❌ تعذر الحصول على إجابة الآن: ${error.message?.slice(0, 120) || "خطأ غير معروف"}`, threadID, null, messageID);
    }
  },
};

export const $plugin = { name: "xx-commands-xalman-gpt", meta: { category: "command-xalman", path: "src/commands/xalman/gpt.js" }, setup() {} };
