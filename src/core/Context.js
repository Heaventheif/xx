"use strict";
function buildMessageAPI(api, threadID, messageID) {
  return {
    reply: (t, cb) => new Promise((resolve, reject) => {
      global.safeSend(api, t, threadID, (err, info) => {
        if (cb) cb(err, info);
        if (err) reject(err);
        else resolve(info || {});
      }, messageID);
    }),
    unsend: (msgID, tid) => {
      try { api.unsendMessage(msgID, tid || threadID, () => {}); } catch (_) {}
    },
    registerReply: (id, d, cb, senderID) => {
      global.Kagenou.replies[id] = {
        callback: cb,
        author: senderID,
        timestamp: Date.now(),
        ...d,
      };
    },
  };
}
function buildCommandContext({ api, event, args = [], role = 0, prefix = "", isGroupAdmin = false }) {
  const { threadID, messageID } = event;
  const isGroup = !!event.isGroup;
  return {
    api,
    event,
    args,
    role,
    isGroup,
    isDM: !isGroup,
    isGroupAdmin,
    message: buildMessageAPI(api, threadID, messageID),
    prefix,
    usersData: global.usersData,
    globalData: global.globalData,
    db: global.db,
  };
}
export { buildMessageAPI, buildCommandContext };

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-core-context',
  meta: { category: 'core', path: 'src/core/Context.js' },
  setup(_ctx) {
    // provides: buildCommandContext, buildMessageAPI
  },
};
