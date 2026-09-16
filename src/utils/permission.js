"use strict";

/**
 * فحص صلاحيات المستخدم قبل تنفيذ أوامر الإدارة
 *
 * @param {object} api          — كائن fca-unofficial API
 * @param {object} event        — حدث الرسالة
 * @param {string[]} allowedRoles — ["groupAdmin", "botDev"]
 * @returns {Promise<boolean>}
 */
async function checkPermission(api, event, allowedRoles = []) {
  const { threadID, senderID } = event;

  // ── مطور البوت دائماً مسموح له ────────────────────────────────
  if (allowedRoles.includes("botDev")) {
    const devList = global.GoatBot?.config?.adminBot || [];
    if (devList.includes(senderID)) return true;
  }

  // ── مشرف المجموعة ─────────────────────────────────────────────
  if (allowedRoles.includes("groupAdmin")) {
    try {
      const info = await new Promise((res, rej) =>
        api.getThreadInfo(threadID, (err, d) => (err ? rej(err) : res(d)))
      );
      const adminIDs = (info.adminIDs || []).map((a) =>
        typeof a === "object" ? a.uid : a
      );
      if (adminIDs.includes(senderID)) return true;
    } catch {
      return false;
    }
  }

  return false;
}

module.exports = { checkPermission };
