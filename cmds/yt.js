"use strict";

import fs from "fs-extra";
import { searchWithFallback, downloadWithFallback, cleanTemp } from "../utils/ytProviders";
import { buildListText, attachReactionPicker } from "../utils/reactionPicker";

// Download the resolved media (trying all providers in order) and send it to the thread.
async function downloadAndSend(api, threadID, messageID, ytUrl, wantMp4, listMsgId = null) {
  let filePath = null;
  try {
    const dl = await downloadWithFallback(ytUrl, wantMp4);
    filePath = dl.filePath;

    const fmtDur = (sec) => {
      const s = parseInt(sec) || 0;
      if (!s) return "";
      const m = Math.floor(s / 60), ss = s % 60;
      return ` ⏱ ${m}:${String(ss).padStart(2, "0")}`;
    };

    const body =
      `${wantMp4 ? "🎬" : "🎵"} ${dl.title}` +
      `${fmtDur(dl.duration)}` +
      `${dl.uploader ? `\n📺 ${dl.uploader}` : ""}` +
      `\n🎚 ${wantMp4 ? "360p" : "128kbps"}`;

    await new Promise((res, rej) =>
      global.safeSend(api,
        { body, attachment: fs.createReadStream(filePath) },
        threadID,
        err => err ? rej(err) : res(),
        messageID
      )
    );

    if (listMsgId) { try { await api.unsendMessage(listMsgId, threadID); } catch (_) {} }

  } catch (err) {
    global.safeSend(api, `❌ ${(err.message || "خطأ غير معروف").substring(0, 300)}`, threadID, null, messageID);
  } finally {
    await cleanTemp(filePath);
  }
}

export default {
  config: {
    name: "yt",
    // Old numbered variants (يوتيوب1/2/3) and provider-specific names (yt2, ydl)
    // now all route to this single command, which tries every backend automatically.
    aliases: ["يوتيوب"],
    version: "7.0",
    role: 0,
    countDown: 15,
    category: "وسائط وتحميل",
    description: "تحميل من يوتيوب (يجرّب عدة مزوّدين تلقائياً) — أضف s لعرض قائمة، وmp4 للفيديو",
    usage: [
      "{pn}يوتيوب <اسم> — تحميل أول نتيجة مباشرة (MP3)",
      "{pn}يوتيوب s <اسم> — عرض قائمة نتائج",
      "{pn}يوتيوب mp4 <اسم> — تحميل أول نتيجة مباشرة (MP4)",
      "{pn}يوتيوب s mp4 <اسم> — عرض قائمة نتائج (MP4)",
      "{pn}يوتيوب <رابط> — تحميل مباشر MP3",
      "{pn}يوتيوب mp4 <رابط> — تحميل مباشر MP4",
    ],
  },

  // Command entry point: search or download from a YouTube URL/query.
  onStart: async ({ api, message, args, event }) => {
    const { threadID, messageID } = event;

    if (!args[0]) return message.reply(
      "📥 يوتيوب دونلودر\n\n" +
      "🎵 yt <اسم>          — تحميل مباشر (MP3)\n" +
      "🎬 yt mp4 <اسم>      — تحميل مباشر (MP4)\n" +
      "📋 yt s <اسم>        — قائمة نتائج (MP3)\n" +
      "📋 yt s mp4 <اسم>    — قائمة نتائج (MP4)\n" +
      "🔗 yt <رابط>         — تحميل مباشر\n\n" +
      "🎚 الجودة: صوت 128kbps | فيديو 360p"
    );

    let remaining = [...args];
    const showList = remaining[0]?.toLowerCase() === "s";
    if (showList) remaining = remaining.slice(1);

    const wantMp4 = remaining[0]?.toLowerCase() === "mp4";
    if (wantMp4) remaining = remaining.slice(1);

    const query = remaining.join(" ").trim();
    if (!query) return message.reply("❌ أرسل اسم الأغنية أو الرابط.");

    const isUrl = /^https?:\/\//i.test(query);
    if (isUrl) return await downloadAndSend(api, threadID, messageID, query, wantMp4);

    if (!showList) {
      try {
        const results = await searchWithFallback(query, 1);
        return await downloadAndSend(api, threadID, messageID, results[0].url, wantMp4);
      } catch (e) {
        return global.safeSend(api, `❌ ${e.message}`, threadID, null, messageID);
      }
    }

    try {
      const results = await searchWithFallback(query, 10);
      const list = results.slice(0, 10);

      const sent = await new Promise((res, rej) =>
        global.safeSend(api, buildListText(list, wantMp4), threadID,
          (err, info) => err ? rej(err) : res(info), messageID)
      );

      attachReactionPicker({
        sentMessageID: sent?.messageID,
        authorID: event.senderID,
        list,
        onPick: (chosen, wantMp4Alt) =>
          downloadAndSend(api, threadID, messageID, chosen.url, wantMp4Alt, sent.messageID),
      });
    } catch (e) {
      global.safeSend(api, `❌ ${e.message?.substring(0, 150) || "خطأ في البحث"}`, threadID, null, messageID);
    }
  },
};
