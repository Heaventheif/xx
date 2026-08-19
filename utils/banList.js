"use strict";

// Ban list: groups (gid) and users (uid) the bot must never respond to or act
// on, regardless of command, role, or event type. Configured in config.json
// under "bannedGroups" / "bannedUsers". Exposed on `global` since the message
// dispatch loop in index.js calls this before routing to any handler.

global._bannedGroups = new Set();
global._bannedUsers = new Set();

function buildBanSets() {
  global._bannedGroups = new Set((global.config.bannedGroups || []).map(String));
  global._bannedUsers = new Set((global.config.bannedUsers || []).map(String));
}

// True if this thread (group or DM) or this sender is banned — the caller
// should drop the event entirely (no reply, no command execution, no onChat).
function isBanned(threadID, senderID) {
  if (threadID !== undefined && global._bannedGroups.has(String(threadID))) return true;
  if (senderID !== undefined && global._bannedUsers.has(String(senderID))) return true;
  return false;
}

global.isBanned = isBanned;

export { buildBanSets, isBanned };
