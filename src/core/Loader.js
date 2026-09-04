"use strict";
import fs from "fs-extra";
import path from "path";
import { pathToFileURL } from "url";
import chalk from "chalk";

const HANDLER_KEYS = ["onStart", "run", "execute", "main", "handle", "onMessage", "init", "call"];

function resolveModule(raw, file) {
  const mod = (raw.default && typeof raw.default === "object") ? raw.default
    : (typeof raw.default === "function")                       ? raw.default
    : raw;
  if (typeof mod === "function") {
    const name = path.basename(file, ".js").toLowerCase();
    return { name, mod: { run: mod }, handler: mod, onChat: null, onReply: null };
  }
  const handlerKey   = HANDLER_KEYS.find(k => typeof mod[k] === "function");
  const namedHandler = !handlerKey ? HANDLER_KEYS.find(k => typeof raw[k] === "function") : null;
  if (!handlerKey && !namedHandler && !mod.onChat && !raw.onChat) return null;
  const resolved = namedHandler ? { ...raw, ...mod } : mod;
  const rawName  = resolved.config?.name || path.basename(file, ".js");
  const name     = String(rawName).toLowerCase();
  return {
    name,
    mod:     resolved,
    handler: resolved[handlerKey || namedHandler] || null,
    onChat:  resolved.onChat  || raw.onChat  || null,
    onReply: resolved.onReply || raw.onReply || null,
  };
}

function collectCommandFiles(commandsDir) {
  const out = [];
  if (!fs.existsSync(commandsDir)) return out;
  for (const category of fs.readdirSync(commandsDir)) {
    const catDir = path.join(commandsDir, category);
    if (!fs.statSync(catDir).isDirectory()) continue;
    for (const file of fs.readdirSync(catDir)) {
      if (file.endsWith(".js")) out.push(path.join(catDir, file));
    }
  }
  return out;
}

function loadOverrides(commandsDir) {
  const overridesPath = path.join(commandsDir, "..", "..", "cmd-overrides.json");
  global.cmdOverridesPath = path.resolve(overridesPath);
  try {
    if (fs.existsSync(overridesPath)) {
      return JSON.parse(fs.readFileSync(overridesPath, "utf8"));
    }
  } catch (_) {}
  return {};
}

export async function loadCommands(commandsDir) {
  global.commands.clear();
  global.eventCommands = [];

  const overrides  = loadOverrides(commandsDir);
  const fileErrors = [];
  const filePaths  = collectCommandFiles(commandsDir);
  const stamp      = Date.now();

  console.log(chalk.blue(`[CMDS] 📦 بدء تحميل ${filePaths.length} ملف (متوازي)...`));

  const results = await Promise.allSettled(
    filePaths.map(p => import(`${pathToFileURL(p).href}?update=${stamp}`))
  );

  for (let i = 0; i < filePaths.length; i++) {
    const p      = filePaths[i];
    const file   = path.basename(p);
    const result = results[i];

    if (result.status === "rejected") {
      console.warn(chalk.yellow(`[CMDS]   ↳ ${file} ❌ ${result.reason?.message}`));
      fileErrors.push({ file, message: result.reason?.message });
      continue;
    }

    try {
      const resolved = resolveModule(result.value, file);
      if (!resolved) { console.log(chalk.gray(`[CMDS]   ↳ ${file} ⏭️`)); continue; }

      const { name, mod, onChat, onReply } = resolved;
      if (!mod.config) mod.config = {};

      const ov = overrides[name];
      if (ov) {
        if (typeof ov.enabled === "boolean") mod.config.enabled = ov.enabled;
        if (typeof ov.hidden  === "boolean") mod.config.hidden  = ov.hidden;
      }

      global.commands.set(name, mod);
      (mod.config?.aliases || []).forEach(a => global.commands.set(String(a).toLowerCase(), mod));

      if (onReply) { if (!mod.onReply) mod.onReply = onReply; }
      if (onChat)  { if (!mod.onChat)  mod.onChat  = onChat;  global.eventCommands.push(mod); }

      console.log(chalk.gray(`[CMDS]   ↳ ${file} ✅ (${name})`));
    } catch (err) {
      console.warn(chalk.yellow(`[CMDS]   ↳ ${file} ❌ ${err.message}`));
      fileErrors.push({ file, message: err.message });
    }
  }

  console.log(chalk.blue(`[INFO] تم تحميل ${global.commands.size} أمر من أصل ${filePaths.length} ملف`));
  return fileErrors;
}

export { HANDLER_KEYS };
