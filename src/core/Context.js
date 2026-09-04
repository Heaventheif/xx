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
    unsend: (msgID) => {
      try { api.unsendMessage(msgID, threadID, () => {}); } catch (_) {}
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
function buildCommandContext({ api, event, args = [], role = 0 }) {
  const { threadID, messageID } = event;
  return {
    api,
    event,
    args,
    role,
    message: buildMessageAPI(api, threadID, messageID),
    prefix: "",
    usersData: global.usersData,
    globalData: global.globalData,
    db: global.db,
  };
}
export { buildMessageAPI, buildCommandContext };
