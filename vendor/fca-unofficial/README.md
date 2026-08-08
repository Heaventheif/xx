> **ملاحظة (نسخة ESM المدمجة):** هذه نسخة معدّلة تدمج vendor (DDD) + وحدات Nexus (safety/stealth/API إضافية) بصيغة ESM خالصة (`import`/`export`)، بدون أي كود TypeScript، وبدون خطوة بناء CommonJS (لا يوجد `dist/`)، وبدون مجلد `examples/`. استورد مباشرة من `fca-unofficial` عبر `import`.
>
> الإضافات الجديدة المتاحة: `FacebookSafety`, `StealthMode`, `SingleSessionGuard`, `SessionLock`, `attachNexusMethods`, `threadColors` (استخدام: `attachNexusMethods(api, api._defaultFuncs, api._ctx)` بعد تسجيل الدخول).
>
> لا تنس تشغيل `npm install` بعد فك الحزمة لتثبيت التبعيات (`ws`, `mqtt`, `cheerio`, `https-proxy-agent`, `socks-proxy-agent`, إلخ).

# fca-unofficial v5.0.0

> Unofficial Facebook Chat API — clean domain-driven architecture, no native
> dependencies, parallel messaging, health metrics, session safety, and a full
> command system. For **private / internal use** only.

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Login Methods](#login-methods)
- [MessengerClient (High-Level OOP API)](#messengerclient-high-level-oop-api)
- [Domain API (Low-Level)](#domain-api-low-level)
- [Domains Reference](#domains-reference)
- [Command System](#command-system)
- [Safety Modules](#safety-modules)
- [Observability](#observability)
- [Configuration](#configuration)
- [What's New in v5](#whats-new-in-v5)
- [Architecture](#architecture)

---

## Installation

```bash
npm install   # or pnpm install / bun install
```

No native dependencies. No `sqlite3`. No `sequelize`. Pure JS.

---

## Quick Start

```js
import { login } from "fca-unofficial";
import { readFileSync } from "node:fs";

const appState = JSON.parse(readFileSync("appstate.json", "utf8"));

login({ appState }, (err, api) => {
  if (err) throw err;

  api.listenMqtt((err, event) => {
    if (event?.type === "message") {
      api.sendMessage("Got it!", event.threadID);
    }
  });
});
```

### Getting an appState

Export your cookies from a logged-in Facebook session using the
[c3c-fbstate](https://github.com/c3cbot/c3c-fbstate) browser extension, or
any cookie exporter that produces a JSON array in the `appState` format.

**Prefer appState over username/password.** Direct credential login is more
likely to trigger Facebook's checkpoint detection.

---

## Login Methods

### `login(credentials, [options], callback)`

```js
// Recommended: appState / cookies
login({ appState }, (err, api) => { ... });

// With options
login({ appState }, { selfListen: false, listenEvents: true }, (err, api) => { ... });
```

### `loginAsync(credentials, [options]) → Promise<{api, ctx}>`

```js
const { api } = await loginAsync({ appState });
```

### `loginViaAPI(email, password, twoFactor, apiBaseUrl, apiKey)`

Login through an external API server that exchanges credentials for an
appState. The API server endpoint is configurable — the library will **not**
send credentials anywhere unless you explicitly provide `apiBaseUrl`.

---

## MessengerClient (High-Level OOP API)

`MessengerClient` is the recommended way to build bots. It wraps the raw API
with EventEmitter routing, built-in command dispatch, parallel send queuing,
and optional safety/observability modules.

```js
import { login, createMessengerClient } from "fca-unofficial";

login({ appState }, async (err, api) => {
  const client = createMessengerClient(api, {
    commandPrefix: "/",
    ownerIDs: ["100000000000001"],
    maxParallelSends: 5,
    cookieRefresher: true,   // auto-refresh cookies every hour
    sessionGuard: true,      // watch for stale sessions
    healthServer: true,      // GET /health on port 10000
  });

  client.command("ping", async (ctx) => {
    await ctx.api.sendMessage("Pong!", ctx.threadID);
  });

  client.on("message", (event) => console.log(event.body));

  await client.start();
});
```

### Constructor options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `commandPrefix` | `string` | `"/"` | Prefix for command parsing |
| `ownerIDs` | `string[]` | `[]` | User IDs with `owner` permission |
| `maxParallelSends` | `number` | `5` | Max concurrent MQTT sends |
| `cookieRefresher` | `boolean` | `true` | Enable cookie auto-refresh |
| `cookieRefreshIntervalMs` | `number` | `3600000` | Cookie refresh interval |
| `appStatePath` | `string` | `null` | Path to save refreshed appState |
| `sessionGuard` | `boolean` | `true` | Enable session staleness watchdog |
| `healthServer` | `boolean` | `false` | Enable HTTP health endpoint |
| `healthServerPort` | `number` | `10000` | Health server port |

### Events

```
message          — incoming message
messageCreate    — alias for message
message_reply    — message reply
reaction         — message reaction
unsend           — message unsent
typingStart      — user started typing
typingStop       — user stopped typing
readReceipt      — read receipt
threadUpdate     — thread event (join/leave/rename)
ready            — bot connected and listening
stale            — session idle beyond watchdog threshold
error            — error event
```

### Methods

```js
client.send(msg, threadID)         // Promise — respects parallel queue
client.reply(msg, event)           // send a reply to an event
client.react("😍", messageID)      // react to a message
client.unsend(messageID)           // unsend your own message
client.pin(true, messageID, threadID) // pin/unpin a message
client.getMetrics()                // snapshot of HealthMetrics
client.stop()                      // graceful shutdown
```

---

## Domain API (Low-Level)

The raw `api` object returned by `login` follows the classic FCA callback
pattern. Domains are available via `api.client.*`:

```js
// Domain facade
const c = api.client;

// Messages
await c.messages.send("Hello!", threadID);
await c.messages.react("❤️", messageID);
await c.messages.typing(threadID, true);
await c.messages.pin(true, messageID, threadID);
await c.messages.shareLink("https://example.com", threadID, "Check this out");
await c.messages.edit(messageID, "Updated text");
await c.messages.unsend(messageID);
await c.messages.uploadAttachment([stream], threadID);

// Threads
const info = await c.threads.getInfo(threadID);
const list = await c.threads.getList(10);
await c.threads.setTitle(threadID, "New name");
await c.threads.addUsers(threadID, [userID]);
await c.threads.createPoll("Favorite color?", threadID, ["Red", "Blue"]);

// Users
const info = await c.users.getInfo([userID]);
const friends = await c.users.getFriends();

// Account
await c.account.changeBio("Hello world");
await c.account.follow(userID);
await c.account.setProfileGuard(true);
await c.account.logout();

// Scheduler
const id = c.scheduler.scheduleMessage("Reminder!", threadID, Date.now() + 60000);
c.scheduler.cancelScheduledMessage(id);

// Media
await c.media.createPost({ body: "Hello Facebook!", privacy: "PUBLIC" });
const packs = await c.media.searchStickers("happy");

// HTTP
const data = await c.http.get("https://www.facebook.com/ajax/...");
```

---

## Domains Reference

### Messages domain

| Method | Description |
|--------|-------------|
| `send(msg, threadID)` | Send text, sticker, attachment, or reply |
| `edit(messageID, text)` | Edit a sent message |
| `delete(messageID, threadID)` | Delete (hide for you) a message |
| `unsend(messageID)` | Unsend a message (removes for everyone) |
| `react(emoji, messageID)` | React to a message |
| `markRead(threadID)` | Mark thread as read |
| `markDelivered(messageID, threadID)` | Send delivery receipt |
| `markSeen(threadID)` | Mark thread as seen |
| `markReadAll()` | Mark all threads as read |
| `typing(threadID, isTyping)` | Toggle typing indicator |
| `pin(pinned, messageID, threadID)` | Pin or unpin a message |
| `shareLink(url, threadID, body?)` | Share a URL with preview |
| `shareContact(userID, threadID)` | Share a contact card |
| `forwardAttachment(attachmentID, threadIDs)` | Forward an attachment |
| `uploadAttachment(streams)` | Upload files, returns attachment IDs |
| `setThreadColor(color, threadID)` | Change thread theme color |
| `setThreadEmoji(emoji, threadID)` | Change thread emoji |
| `get(messageID)` | Fetch a specific message |
| `getEmojiUrl(emoji, size?)` | Get CDN URL for an emoji |
| `getThreadColors()` | List available thread colors |
| `resolvePhotoUrl(fbPhotoID)` | Resolve photo URL from FB ID |

### Threads domain

| Method | Description |
|--------|-------------|
| `getInfo(threadID)` | Full thread metadata |
| `getList(limit, cursor?)` | Paginated thread list |
| `getHistory(threadID, amount)` | Message history |
| `getPictures(threadID, offset, limit)` | Images shared in thread |
| `createGroup(message, participants)` | Create a new group |
| `addUsers(threadID, userIDs)` | Add members to group |
| `removeUser(threadID, userID)` | Remove a member |
| `setAdmin(threadID, userID, isAdmin)` | Promote/demote admin |
| `setTitle(threadID, name)` | Rename group |
| `setImage(threadID, stream)` | Change group photo |
| `setColor(color, threadID)` | Change theme color |
| `setEmoji(emoji, threadID)` | Change theme emoji |
| `setNickname(threadID, userID, name)` | Set nickname |
| `mute(threadID, duration)` | Mute notifications |
| `archive(threadID, archived)` | Archive/unarchive |
| `delete(threadID)` | Delete thread |
| `handleMessageRequest(threadID, accept)` | Accept/decline message request |
| `createPoll(question, threadID, options)` | Create a poll |
| `search(query)` | Search for threads |

### Account domain

| Method | Description |
|--------|-------------|
| `getCurrentUserID()` | Own user ID |
| `changeBio(text)` | Update profile bio |
| `changeAvatar(stream)` | Update profile photo |
| `handleFriendRequest(userID, accept)` | Accept/decline friend request |
| `unfriend(userID)` | Remove a friend |
| `changeBlockedStatus(userID, blocked)` | Block/unblock a user |
| `follow(userID, follow?)` | Follow/unfollow a user |
| `setProfileGuard(enabled)` | Toggle profile picture guard |
| `setPostReaction(postID, reaction)` | React to a post |
| `refreshFb_dtsg()` | Refresh session security token |
| `logout()` | Log out |
| `getAppState()` | Export current session cookies |

### Media domain

| Method | Description |
|--------|-------------|
| `createPost({body, privacy?, targetID?})` | Create a Facebook post |
| `searchStickers(query, limit?)` | Search sticker packs |

### Scheduler domain

| Method | Description |
|--------|-------------|
| `scheduleMessage(msg, threadID, when)` | Schedule a message for later |
| `cancelScheduledMessage(id)` | Cancel a scheduled message |
| `getScheduledMessage(id)` | Get info on a scheduled message |
| `listScheduledMessages()` | All pending scheduled messages |
| `clearScheduledMessages()` | Cancel all scheduled messages |

---

## Command System

```js
import { createCommandRegistry, Command } from "fca-unofficial";

const registry = createCommandRegistry({ prefix: "!", ownerIDs: ["123"] });

const hello = new Command("hello", {
  description: "Say hello",
  aliases: ["hi", "hey"],
  cooldownMs: 3000,
  category: "fun",
  handler: async ({ api, threadID, args }) => {
    await api.sendMessage(`Hello, ${args[0] ?? "world"}!`, threadID);
  }
});

registry.register(hello);

// In your message listener:
api.listenMqtt((err, event) => {
  if (event?.type !== "message") return;
  registry.dispatch(event.body, {
    senderID: event.senderID,
    isGroup: !!event.isGroup,
    api,
    threadID: event.threadID,
    messageID: event.messageID,
    event,
  });
});
```

### Command options

| Option | Type | Description |
|--------|------|-------------|
| `description` | `string` | Human-readable description |
| `usage` | `string` | Usage hint (e.g. `!cmd <user>`) |
| `aliases` | `string[]` | Alternative names |
| `category` | `string` | Group for `byCategory()` |
| `cooldownMs` | `number` | Per-user cooldown in milliseconds |
| `ownerOnly` | `boolean` | Restrict to owner IDs |
| `groupOnly` | `boolean` | Only works in group chats |
| `dmOnly` | `boolean` | Only works in DMs |
| `hidden` | `boolean` | Hide from `listPublic()` |
| `minArgs` / `maxArgs` | `number` | Argument count bounds |
| `args` | `Array<{name, type, required?}>` | Typed argument definitions |
| `handler` | `Function` | `async (ctx) => void` |

---

## Safety Modules

### CookieRefresher

Keeps sessions alive by periodically visiting Facebook endpoints to prevent
cookie expiry.

```js
import { createCookieRefresher } from "fca-unofficial";

const refresher = createCookieRefresher({
  intervalMs: 3600000,    // refresh every 1 hour
  expiryDays: 60,         // extend cookie expiry to 60 days
  appStatePath: "./appstate.json",  // auto-save after each refresh
});

// After login:
refresher.attach(ctx, defaultFuncs);
```

### DeviceManager

Persists a stable device fingerprint (device ID + user agent) to disk. Reusing
the same fingerprint across restarts prevents Facebook from treating each
restart as a new device login.

```js
import { createDeviceManager } from "fca-unofficial";

const dm = await createDeviceManager({ filePath: "./.device-profile.json" }).init();
console.log(dm.userAgent); // stable Chrome UA
console.log(dm.deviceId);  // stable fca_<uuid>
```

### SessionGuard

Watches for session staleness (no events received within `watchdogIdleMs`) and
mirrors `fb_dtsg` / `jazoest` to disk for recovery after crashes on ephemeral
platforms.

```js
import { createSessionGuard } from "fca-unofficial";

const guard = createSessionGuard({ watchdogIdleMs: 5 * 60 * 1000 });
guard.attach(ctx, {
  onStale: (ctx) => console.warn("Session stale — reconnecting"),
});

// Call this inside your message listener:
guard.heartbeat();
```

---

## Observability

### HealthMetrics

Tracks MQTT connection health, message throughput, ack latency (p95), and
delivery rates.

```js
import { createHealthMetrics } from "fca-unofficial";

const metrics = createHealthMetrics();
metrics.onConnect();
metrics.onMessage();
metrics.onAck(42); // 42ms ack latency

console.log(metrics.snapshot());
// { uptimeSec, reconnects, messagesReceived, p95AckLatencyMs, deliveryRate, ... }
```

### HealthServer

Exposes a `GET /health` endpoint returning JSON metrics — useful for Render,
Railway, Fly.io keep-alive pings and uptime monitors.

```js
import { createHealthServer } from "fca-unofficial";

const server = createHealthServer({ port: 10000 });
server.attachMetrics(metrics); // optional — richer payload
server.start();

// GET http://localhost:10000/health
// → { "status": "ok", "version": "5.0.0", "uptime": 3600, "metrics": { ... } }
```

### PerformanceManager

In-memory TTL cache + request tracking. Avoid redundant API calls:

```js
import { createPerformanceManager } from "fca-unofficial";

const pm = createPerformanceManager({ cacheSize: 1000, cacheTTL: 300000 });

// In your thread info handler:
let info = pm.get(`thread:${threadID}`);
if (!info) {
  info = await getThreadInfo(threadID);
  pm.set(`thread:${threadID}`, info);
}
```

---

## Configuration

> **⚠️ SECURITY:** `fca-config.json` can hold a plaintext `credentials.password`,
> `apiKey`, and `remoteControl.token`. Never commit it. This repo's
> `.gitignore` already excludes it — keep that entry, copy
> `fca-config.example.json` to `fca-config.json` locally, and if a real
> secret ever does land in git history, rotate it (change the Facebook
> password / reissue the token) rather than just deleting the commit.

`fca-config.json` (auto-generated via `writeConfigTemplate()`):

```json
{
  "autoUpdate": false,
  "checkUpdate": { "enabled": false },
  "mqtt": { "enabled": true, "reconnectInterval": 3600 },
  "autoLogin": false,
  "apiServer": "",
  "apiKey": "",
  "antiDetection": {
    "enabled": false,
    "requestDelayMin": 0,
    "requestDelayMax": 0,
    "userAgentPool": []
  },
  "remoteControl": { "enabled": false }
}
```

---

## What's New in v5

### Added (from Nexus-FCA, reimplemented cleanly)

| Feature | Module |
|---------|--------|
| Cookie auto-refresh | `lib/safety/cookie-refresher.js` |
| Stable device fingerprint | `lib/safety/device-manager.js` |
| Session watchdog + token mirror | `lib/safety/session-guard.js` |
| TTL cache + request metrics | `lib/performance/manager.js` |
| MQTT ack p95 + delivery tracking | `lib/performance/health-metrics.js` |
| HTTP health endpoint | `lib/performance/health-server.js` |
| Command registry (aliases, cooldowns, permissions) | `lib/command/registry.js` |
| `pinMessage` / `unpinMessage` | `lib/domains/messages/commands/pin-message.js` |
| `shareLink` | `lib/domains/messages/commands/share-link.js` |
| `follow` / `unfollow` | `lib/domains/account/commands/follow.js` |
| `setProfileGuard` | `lib/domains/account/commands/set-profile-guard.js` |
| `createPost` | `lib/domains/media/commands/create-post.js` |
| `searchStickers` | `lib/domains/media/queries/search-stickers.js` |
| `MessengerClient` OOP wrapper | `lib/app/messenger-client.js` |
| Parallel send queue (up to N concurrent) | `MessengerClient` |
| Scheduled messages | `lib/domains/scheduler/` |

### Kept (vendor v4 base)

- Clean domain-driven architecture (`domains/messages/`, `domains/threads/`, …)
- ESM-first with CJS compatibility shim
- appState-first login (no raw credential storage)
- No native dependencies (no sqlite3, no sequelize)
- JSON-local cookie/state storage
- Robust request retry with exponential backoff + jitter
- Typed message/thread/user formatters
- `MessengerBot` Telegraf-style middleware
- `createFcaClient` domain facade
- Scheduler domain

### Removed

- `sequelize` / `sqlite3` database dependency
- `axios` / `got` duplicate HTTP clients (uses native `fetch`-based transport)
- Hardcoded appState API server (must be explicitly configured)
- Auto-update checks enabled by default

---

## Architecture

```
lib/
├── core/           Login, state, request helper, MQTT bootstrap, config
├── transport/
│   ├── http/       GraphQL, Mercury, upload
│   └── realtime/   MQTT stream, ls-requests, publish
├── domains/
│   ├── messages/   send, edit, delete, unsend, react, pin, shareLink, …
│   ├── threads/    getInfo, getList, create, manage members, poll, …
│   ├── users/      getUserInfo, getFriendsList, getUserID, …
│   ├── account/    changeBio, follow, setProfileGuard, logout, …
│   ├── media/      createPost, searchStickers
│   ├── http/       low-level httpGet / httpPost passthrough
│   ├── realtime/   listener, middleware, delta parser
│   └── scheduler/  schedule / cancel / list deferred messages
├── app/
│   ├── create-client.js     Domain facade (api.client.*)
│   ├── messenger-bot.js     Telegraf-style middleware EventEmitter
│   ├── messenger-client.js  High-level OOP wrapper (NEW in v5)
│   └── messenger-context.js Context helpers
├── safety/
│   ├── cookie-refresher.js  Proactive cookie TTL extension
│   ├── device-manager.js    Persistent device fingerprint
│   └── session-guard.js     Token mirror + idle watchdog
├── performance/
│   ├── manager.js           TTL cache + request metrics
│   ├── health-metrics.js    MQTT p95 ack latency + delivery rates
│   └── health-server.js     HTTP /health endpoint
├── command/
│   └── registry.js          Command registration, dispatch, cooldowns
├── utils/                   Headers, cookies, formatters, request helpers
├── compat/                  Legacy callback adapters, api-registry
└── types/                   JSDoc type definitions
```
