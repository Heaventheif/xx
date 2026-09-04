"use strict";
export function checkAuth(senderID, command) {
  const role    = global.getUserRole(senderID);
  const reqRole = command.config?.role ?? 0;
  if (role < reqRole) return "⚠️ هذا الأمر للمشرفين فقط";
  return null;
}
