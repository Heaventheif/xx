"use strict";
function buildRoleSets() {
  global._rolesets = {
    dev: new Set((global.config.developers || []).map(String)),
    vip: new Set((global.config.vips || []).map(String)),
    mod: new Set((global.config.moderators || []).map(String)),
    adm: new Set((global.config.admins || []).map(String)),
  };
}
function getUserRole(uid) {
  uid = String(uid);
  const r = global._rolesets;
  if (r.dev.has(uid)) return 4;
  if (r.adm.has(uid)) return 3;
  if (r.mod.has(uid)) return 2;
  if (r.vip.has(uid)) return 1;
  return 0;
}
function setCooldown(u, c, t) {
  global.userCooldowns.set(`${u}:${c}`, Date.now() + t * 1000);
}
function checkCooldown(u, c) {
  const key = `${u}:${c}`;
  const exp = global.userCooldowns.get(key);
  if (!exp || Date.now() >= exp) {
    global.userCooldowns.delete(key);
    return null;
  }
  return `⏳ انتظر ${Math.ceil((exp - Date.now()) / 1000)} ث`;
}
global.getUserRole = getUserRole;
global.setCooldown = setCooldown;
global.checkCooldown = checkCooldown;
export { buildRoleSets, getUserRole, setCooldown, checkCooldown };
