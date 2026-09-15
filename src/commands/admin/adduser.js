import http from '../../utils/fetchHttp.js';
import { getThreadInfoCached } from '../../core/Router.js';
const FB_GRAPH_TOKEN = process.env.FB_GRAPH_ACCESS_TOKEN || "";
const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept-Language": "ar,en;q=0.9",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "sec-fetch-site": "none",
  "sec-fetch-mode": "navigate",
};
const _dailyAddLog = new Map();
const _DAILY_LIMIT = 8;
const _DAY_MS = 24 * 60 * 60 * 1000;

export default {
  config: {
    name: "adduser",
    aliases: ["اضافة"],
    version: "4.1.0",
    author: "Enhanced UID Extractor",
    countDown: 5,
    role: 0,
    category: "إدارة وإشراف",
    description: "إضافة عضو للمجموعة عبر UID أو رابط فيسبوك أو يوزرنيم",
    usage: [
      "{pn}adduser <UID> — إضافة بمعرف رقمي مباشر",
      "{pn}adduser <رابط فيسبوك> — إضافة عبر رابط بروفايل",
      "{pn}adduser <يوزرنيم> — إضافة عبر اسم المستخدم النصي",
    ],
  },
  onStart: async function ({ api, event, args, message, isGroupAdmin }) {
    const { threadID, messageID, senderID } = event;

    // isGroupAdmin يأتي جاهزاً من Router بدل استدعاء getThreadInfo مرة أخرى
    if (!isGroupAdmin) {
      return global.safeSend(api, "❌ هذا الأمر لمشرفي المجموعة فقط!", threadID, null, messageID);
    }

    const now = Date.now();
    const log = (_dailyAddLog.get(senderID) || []).filter(t => now - t < _DAY_MS);
    if (log.length >= _DAILY_LIMIT) {
      const waitMin = Math.ceil((_DAY_MS - (now - log[0])) / 60000);
      return global.safeSend(api, 
        `⚠️ وصلت للحد الأقصى (${_DAILY_LIMIT} إضافات/يوم) لحماية الحساب من الحظر.\n⏳ حاول بعد ${waitMin} دقيقة تقريباً.`,
        threadID, null, messageID
      );
    }
    const input = args.join(" ").trim();
    if (!input) {
      return global.safeSend(api, "❌ الاستخدام:\n.adduser [UID] أو [رابط فيسبوك] أو [يوزرنيم]", threadID, null, messageID);
    }
    // جلب threadInfo من الـ cache المشترك (مرة واحدة لكل مجموعة كل 5 دقائق)
    const threadInfo = await getThreadInfoCached(api, threadID);
    if (!threadInfo) {
      return global.safeSend(api, "❌ فشل في جلب معلومات المجموعة — حاول مرة أخرى.", threadID, null, messageID);
    }

    const waitMsg = await global.safeSend(api, "🔄 جاري المعالجة...", threadID, null, messageID);
    let _lastEditedText = null;
    const editMsg = async (text) => {
      if (_lastEditedText === text) return; // منع التكرار
      _lastEditedText = text;
      if (waitMsg?.messageID) {
        try {
          await api.editMessage(text, waitMsg.messageID);
          return;
        } catch (e1) { console.debug("[adduser] editMessage فشل، سيُرسل كرسالة جديدة:", e1?.message); }
      }
      // fallback: أرسل رسالة جديدة إذا فشل editMessage
      await global.safeSend(api, text, threadID, null, messageID);
    };
    try {
      let uid = null;
      let userName = "المستخدم";
      if (/^\d{5,20}$/.test(input)) {
        uid = input;
      } else if (/facebook\.com|fb\.com|fb\.me/i.test(input)) {
        await editMsg("🔍 جاري استخراج UID من الرابط...");
        uid = await resolveUID(input);
      } else if (/^[a-zA-Z][a-zA-Z0-9._]{1,48}[a-zA-Z0-9]$/.test(input)) { // C-03 fix: reject dots-only / traversal patterns
        await editMsg("🔍 جاري البحث عن المستخدم...");
        uid = await resolveUID(`https://www.facebook.com/${input}`);
      }
      if (!uid) {
        return await editMsg(
          "❌ فشل استخراج UID.\n" +
          "💡 الحل: استخدم UID الرقمي مباشرة.\n" +
          "🔗 للحصول على UID: .uid [الرابط]"
        );
      }
      // مقارنة String صريحة لأن participantIDs قد تكون أرقام أو نصوص
      if (threadInfo.participantIDs.some(id => String(id) === String(uid))) {
        return await editMsg("⚠️ المستخدم موجود بالفعل في المجموعة.");
      }
      try {
        const info = await api.getUserInfo(uid);
        if (info?.[uid]) userName = info[uid].name || userName;
      } catch (infoErr) { console.debug("[adduser] getUserInfo failed for", uid, ":", infoErr?.message); }
      await editMsg(`🔄 جاري إضافة ${userName}...`);
      try {
        await new Promise((resolve, reject) => {
          api.addUserToGroup(uid, threadID, (err) => err ? reject(err) : resolve());
        });
      } catch (addError) {
        const errStr = addError?.error || addError?.message || String(addError);
        let errorMsg = `❌ فشل في إضافة ${userName}\n`;
        if (/Not enough members|approval/i.test(errStr)) errorMsg += "⚠️ المجموعة تتطلب موافقة الأدمن على الانضمام.";
        else if (/Privacy|privacy/i.test(errStr))        errorMsg += "🔒 المستخدم أقفل إعدادات الخصوصية — لا يمكن إضافته.";
        else if (/blocked/i.test(errStr))                errorMsg += "🚫 البوت محظور من قِبل هذا المستخدم أو بالعكس.";
        else                                              errorMsg += errStr || "سبب غير معروف";
        console.warn(`[adduser] addUserToGroup فشل uid=${uid}:`, errStr);
        return await editMsg(errorMsg);
      }
      await editMsg(`✅ تمت الإضافة بنجاح!\n👤 الاسم: ${userName}\n🆔 UID: ${uid}`);
      log.push(now);
      _dailyAddLog.set(senderID, log);
      // أضف الـ UID لقائمة المشاركين محلياً لمنع الإضافة المزدوجة لو نُفِّذ الأمر مرتين سريعاً
      threadInfo.participantIDs.push(String(uid));
      const remaining = Math.max(0, _DAILY_LIMIT - log.length);
      if (remaining <= 2) {
        await global.safeSend(api, `ℹ️ تبقى لك ${remaining} عملية إضافة اليوم.`, threadID, null, messageID);
      }
    } catch (error) {
      console.error("[AddUser Fatal]", error);
      await editMsg("❌ حدث خطأ غير متوقع.");
    }
  }
};
async function resolveUID(input) {
  input = input.trim();
  const numInUrl = input.match(/(?:facebook\.com\/(?:profile\.php\?id=)?|\/)?(\d{8,20})/);
  if (numInUrl) return numInUrl[1];
  let slug = input;
  try {
    slug = new URL(input.startsWith("http") ? input : "https://" + input).pathname
      .replace(/^\/+|\/+$/g, "");
  } catch (_) {
    slug = input.replace(/^.*facebook\.com\//, "").replace(/\/+$/, "").split("/")[0];
  }
  const ignoreSlugs = ["watch", "reel", "reels", "stories", "groups", "marketplace",
    "pages", "events", "photo", "video", "share", "sharer", "permalink"];
  if (!slug || ignoreSlugs.includes(slug.toLowerCase())) return null;
  if (FB_GRAPH_TOKEN) {
    try {
      const res = await http.get(`https://graph.facebook.com/${encodeURIComponent(slug)}`, {
        params: { fields: "id", access_token: FB_GRAPH_TOKEN },
        timeout: 8000,
      });
      if (res.data?.id) return res.data.id;
    } catch (e2) { console.debug("[adduser] step-2 error:", e2?.message); }
  }
  const profileUrl = `https://www.facebook.com/${slug}`;
  try {
    const html = await fetchHTML(profileUrl);
    const id   = extractIDFromHTML(html);
    if (id) return id;
  } catch (e3) { console.debug("[adduser] step-3 error:", e3?.message); }
  try {
    const html = await fetchHTML(`https://mbasic.facebook.com/${slug}`);
    const id   = extractIDFromHTML(html);
    if (id) return id;
  } catch (e4) { console.debug("[adduser] step-4 error:", e4?.message); }
  try {
    const res = await http.get(`https://lookup2.p.rapidapi.com/`, {
      params: { username: slug },
      headers: {
        "x-rapidapi-host": "lookup2.p.rapidapi.com",
        "x-rapidapi-key": process.env.RAPIDAPI_KEY || "",
      },
      timeout: 8000,
    });
    if (res.data?.id) return res.data.id;
  } catch (e5) { console.debug("[adduser] step-5 error:", e5?.message); }
  return null;
}
async function fetchHTML(url, options = {}) {
  const res = await http({
    url,
    method:  options.method || "GET",
    data:    options.data,
    headers: { ...BROWSER_HEADERS, ...(options.headers || {}) },
    timeout: 15000,
  });
  return typeof res.data === "string" ? res.data : JSON.stringify(res.data);
}
function extractIDFromHTML(html) {
  if (!html) return null;
  const patterns = [
    /"userID"\s*:\s*"(\d+)"/,
    /"entity_id"\s*:\s*"(\d+)"/,
    /"profileOwnerID"\s*:\s*"(\d+)"/,
    /"USER_ID"\s*:\s*"(\d+)"/,
    /"owner"\s*:\s*\{"__typename"[^}]*"id"\s*:\s*"(\d+)"/,
    /content="https:\/\/www\.facebook\.com\/(\d{8,20})"/,
    /"id"\s*:\s*"(\d{8,20})"\s*,\s*"name"/,
    /profile_id=(\d{8,20})/,
    /\"subject_id\"\s*:\s*\"(\d{8,20})\"/,
    /pageID\s*=\s*"(\d{8,20})"/,
    /__user=(\d{8,20})/,
    /\{"uid":(\d{8,20})\}/,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1] && match[1] !== "0") return match[1];
  }
  return null;
}

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-commands-admin-adduser',
  meta: { category: 'command-admin', path: 'src/commands/admin/adduser.js' },
  setup(_ctx) {
    // see module exports
  },
};
