"use strict";
global._bannedGroups = new Set();
global._bannedUsers = new Set();
function buildBanSets() {
  global._bannedGroups = new Set((global.config.bannedGroups || []).map(String));
  global._bannedUsers = new Set((global.config.bannedUsers || []).map(String));
}
function isBanned(threadID, senderID) {
  if (threadID !== undefined && global._bannedGroups.has(String(threadID))) return true;
  if (senderID !== undefined && global._bannedUsers.has(String(senderID))) return true;
  return false;
}
global.isBanned = isBanned;
export { buildBanSets, isBanned };
