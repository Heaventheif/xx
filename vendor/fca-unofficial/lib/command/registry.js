export
// ── Command ───────────────────────────────────────────────────────────────────

class Command {
  /**
   * @param {string} name
   * @param {{
   *   description?: string,
   *   usage?: string,
   *   aliases?: string[],
   *   category?: string,
   *   permissions?: string[],
   *   cooldownMs?: number,
   *   dmOnly?: boolean,
   *   groupOnly?: boolean,
   *   ownerOnly?: boolean,
   *   hidden?: boolean,
   *   minArgs?: number,
   *   maxArgs?: number,
   *   args?: Array<{name: string, type?: 'string'|'number'|'boolean'|'user', required?: boolean}>,
   *   handler?: Function,
   * }} options
   */
  constructor(name, options = {}) {
    this.name = name.toLowerCase();
    this.description = options.description ?? "No description provided.";
    this.usage = options.usage ?? `/${name}`;
    this.aliases = (options.aliases ?? []).map(a => a.toLowerCase());
    this.category = options.category ?? "general";
    this.permissions = options.permissions ?? [];
    this.cooldownMs = options.cooldownMs ?? 0;
    this.dmOnly = options.dmOnly ?? false;
    this.groupOnly = options.groupOnly ?? false;
    this.ownerOnly = options.ownerOnly ?? false;
    this.hidden = options.hidden ?? false;
    this.minArgs = options.minArgs ?? 0;
    this.maxArgs = options.maxArgs ?? Infinity;
    this.args = options.args ?? [];
    this.handler = options.handler ?? null;
    this.enabled = options.enabled !== false;

    /** @type {Map<string, Command>} */
    this.subcommands = new Map();
    this.stats = {
      used: 0,
      errors: 0,
      lastUsedAt: 0
    };
    /** @type {Map<string, number>} userID -> last used timestamp */
    this._cooldownMap = new Map();
  }

  /** Register a subcommand. Returns `this` for chaining. */
  addSubcommand(subCmd) {
    if (subCmd instanceof Command) {
      this.subcommands.set(subCmd.name, subCmd);
      for (const alias of subCmd.aliases) this.subcommands.set(alias, subCmd);
    }
    return this;
  }
  setHandler(fn) {
    this.handler = fn;
    return this;
  }

  /**
   * Returns null if allowed, or an error string explaining why not.
   * @param {string} userID
   * @param {string[]} userPerms
   * @param {{isGroup: boolean}} ctx
   */
  checkGuards(userID, userPerms = [], ctx = {}) {
    if (!this.enabled) return "This command is currently disabled.";
    if (this.ownerOnly && !userPerms.includes("owner")) return "This command is for owners only.";
    if (this.dmOnly && ctx.isGroup) return "This command can only be used in DMs.";
    if (this.groupOnly && !ctx.isGroup) return "This command can only be used in group chats.";
    if (this.permissions.length > 0 && !this.permissions.some(p => userPerms.includes(p))) {
      return `Missing permission: ${this.permissions.join(", ")}`;
    }
    if (this.cooldownMs > 0) {
      const last = this._cooldownMap.get(userID) ?? 0;
      const remaining = this.cooldownMs - (Date.now() - last);
      if (remaining > 0) {
        return `Cooldown: please wait ${Math.ceil(remaining / 1000)}s before using /${this.name} again.`;
      }
    }
    return null;
  }

  /** Record a successful invocation and reset cooldown for `userID`. */
  recordUse(userID) {
    this.stats.used++;
    this.stats.lastUsedAt = Date.now();
    if (this.cooldownMs > 0) this._cooldownMap.set(userID, Date.now());
  }
  recordError() {
    this.stats.errors++;
  }

  /**
   * Validate provided args against the command's arg definitions.
   * Returns `{valid: true}` or `{valid: false, error: string}`.
   */
  validateArgs(args) {
    if (args.length < this.minArgs) {
      return {
        valid: false,
        error: `Requires at least ${this.minArgs} argument(s). Usage: ${this.usage}`
      };
    }
    if (args.length > this.maxArgs && this.maxArgs !== Infinity) {
      return {
        valid: false,
        error: `Accepts at most ${this.maxArgs} argument(s). Usage: ${this.usage}`
      };
    }
    for (let i = 0; i < this.args.length && i < args.length; i++) {
      const def = this.args[i];
      if (def.type === "number" && Number.isNaN(Number(args[i]))) {
        return {
          valid: false,
          error: `Argument '${def.name}' must be a number.`
        };
      }
      if (def.type === "boolean" && !["true", "false", "1", "0"].includes(String(args[i]).toLowerCase())) {
        return {
          valid: false,
          error: `Argument '${def.name}' must be true/false.`
        };
      }
    }
    return {
      valid: true
    };
  }
  toJSON() {
    return {
      name: this.name,
      description: this.description,
      usage: this.usage,
      aliases: this.aliases,
      category: this.category,
      cooldownMs: this.cooldownMs,
      ownerOnly: this.ownerOnly,
      dmOnly: this.dmOnly,
      groupOnly: this.groupOnly,
      hidden: this.hidden,
      stats: this.stats
    };
  }
}
export
// ── CommandRegistry ───────────────────────────────────────────────────────────

class CommandRegistry {
  /**
   * @param {{
   *   prefix?: string,
   *   caseSensitive?: boolean,
   *   ownerIDs?: string[],
   * }} options
   */
  constructor(options = {}) {
    this.prefix = options.prefix ?? "/";
    this.caseSensitive = options.caseSensitive ?? false;
    this.ownerIDs = new Set(options.ownerIDs ?? []);
    /** @type {Map<string, Command>} */
    this._commands = new Map();
  }

  /** Register a command (and its aliases). Returns `this` for chaining. */
  register(command) {
    if (!(command instanceof Command)) throw new TypeError("Expected a Command instance");
    this._commands.set(command.name, command);
    for (const alias of command.aliases) {
      this._commands.set(alias, command);
    }
    return this;
  }

  /** Unregister a command by name (also removes alias entries). */
  unregister(name) {
    const cmd = this._commands.get(name.toLowerCase());
    if (!cmd) return false;
    this._commands.delete(cmd.name);
    for (const alias of cmd.aliases) this._commands.delete(alias);
    return true;
  }

  /**
   * Parse a message body and look up the matching command.
   * Returns `{command, args, subcommand}` or null if not a command.
   */
  parse(text) {
    if (!text) return null;
    const t = this.caseSensitive ? text : text.toLowerCase();
    const prefix = this.caseSensitive ? this.prefix : this.prefix.toLowerCase();
    if (!t.startsWith(prefix)) return null;
    const parts = t.slice(prefix.length).trim().split(/\s+/);
    const cmdName = parts[0];
    if (!cmdName) return null;
    const command = this._commands.get(cmdName);
    if (!command) return null;
    let args = parts.slice(1);
    let subcommand = null;
    if (args.length > 0 && command.subcommands.has(args[0])) {
      subcommand = command.subcommands.get(args[0]);
      args = args.slice(1);
    }
    return {
      command,
      subcommand,
      args
    };
  }

  /**
   * Full command dispatch.
   *
   * @param {string} text - raw message body
   * @param {{
   *   senderID: string,
   *   isGroup: boolean,
   *   api: object,
   *   threadID: string,
   *   messageID: string,
   *   event: object,
   * }} context
   * @param {string[]} userPerms - permission strings for the sender
   * @returns {Promise<boolean>} true if a command was dispatched
   */
  async dispatch(text, context, userPerms = []) {
    const parsed = this.parse(text);
    if (!parsed) return false;
    const target = parsed.subcommand ?? parsed.command;
    const {
      senderID,
      isGroup
    } = context;
    const perms = [...userPerms];
    if (this.ownerIDs.has(senderID)) perms.push("owner");
    const guardError = target.checkGuards(senderID, perms, {
      isGroup
    });
    if (guardError) {
      if (context.api?.sendMessage) {
        await context.api.sendMessage(guardError, context.threadID);
      }
      return true;
    }
    const argValidation = target.validateArgs(parsed.args);
    if (!argValidation.valid) {
      if (context.api?.sendMessage) {
        await context.api.sendMessage(argValidation.error, context.threadID);
      }
      return true;
    }
    try {
      target.recordUse(senderID);
      await target.handler?.({
        ...context,
        args: parsed.args,
        command: target
      });
    } catch (err) {
      target.recordError();
      throw err;
    }
    return true;
  }

  // ── introspection ─────────────────────────────────────────────────────

  get(name) {
    return this._commands.get(this.caseSensitive ? name : name.toLowerCase()) ?? null;
  }

  /** All unique commands (no alias duplicates). */
  list() {
    const seen = new Set();
    return Array.from(this._commands.values()).filter(cmd => {
      if (seen.has(cmd.name)) return false;
      seen.add(cmd.name);
      return true;
    });
  }
  listPublic() {
    return this.list().filter(c => !c.hidden && c.enabled);
  }
  byCategory() {
    const map = {};
    for (const cmd of this.list()) {
      (map[cmd.category] = map[cmd.category] ?? []).push(cmd);
    }
    return map;
  }
  stats() {
    const cmds = this.list();
    return {
      total: cmds.length,
      totalUses: cmds.reduce((s, c) => s + c.stats.used, 0),
      totalErrors: cmds.reduce((s, c) => s + c.stats.errors, 0),
      topCommands: [...cmds].sort((a, b) => b.stats.used - a.stats.used).slice(0, 10).map(c => ({
        name: c.name,
        uses: c.stats.used
      }))
    };
  }
}
export function createCommandRegistry(options) {
  return new CommandRegistry(options);
}
export default {
  createCommandRegistry,
  Command,
  CommandRegistry
};