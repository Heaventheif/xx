# 🤖 SunkenBot v2 — Multi-Host Bot System

<div align="center">

**A Facebook Messenger bot backed by a unified AI/media API layer**

![bun](https://img.shields.io/badge/bun-1.3.4-green?logo=bun)
![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose-47A248?logo=mongodb)
![Express](https://img.shields.io/badge/Express-4-000000?logo=express)
![HuggingFace](https://img.shields.io/badge/HuggingFace-API%20Space-yellow?logo=huggingface)
![License](https://img.shields.io/badge/License-MIT-lightgrey)

</div>

---

## 📋 System Overview

The project has **two separate components working together**:

| Component | Repo | Role |
|---|---|---|
| **SunkenBot** | `ss` (this repo) | A userbot that logs into a Facebook account and reacts to commands inside groups |
| **Sunken Bot API** | `hf-space` | A unified FastAPI server on Hugging Face Spaces providing AI/media services through a plugin system |

```
User in a Facebook group
        │  (gemini, groq, chess, sub, pin, novel2 ...)
        ▼
SunkenBot   (bun userbot)
        │  HTTP POST + header: X-Internal-Token
        ▼
Sunken Bot API  (Hugging Face Space — FastAPI)
        │
        ├── Groq / Gemini / GPT-4o / Cerebras / HF Inference
        ├── Facebook video download, video subtitling, Pinterest images, novels...
        ▼
Reply goes back to the bot → sent to the group
```

The bot (this repo) is the interface users interact with directly on Facebook, while the **Hugging Face Space** acts as an internal backend providing the heavy logic (AI models, media scraping, etc.) via a REST API. Commands that call this API directly are: `chess`, `fb`, `gemini`, `groq`, `manga2`, `novel2`, `pin`, `song`, `sub` — all going through a single unified access point: `utils/hfClient.js`. The rest of the commands (YouTube downloads, text translation, local chess, etc.) run locally within this repo, or through direct external providers (Cerebras, GitHub Models, Gemini TTS, RapidAPI...).

> ℹ️ Details of `hf-space` (plugin architecture, middleware, etc.) are documented in its own repo — refer to it directly. This file only documents what has actually been verified in this repo's code.

---

## 🔑 No Prefix Currently

In its current setup, the bot **does not require any command prefix** — typing the command name directly (e.g. `help` or `gemini your question`) is enough to run it, as long as it doesn't accidentally match normal conversation. This is set via `"Prefix": [""]` in `config.json`.

To later enforce a prefix (e.g. `!`) to reduce accidental replies to normal chat, change the value in `config.json` to an array with a non-empty symbol, e.g. `["!"]` — but this **also requires updating the routing logic in `index.js`** (the command-routing section, around the line parsing `messageText.split(/ +/)`), since the current code does not read `Prefix` from `config.json` in the actual routing; this is a deliberate current decision made per the project owner's request.

---

## 🔐 Internal API Protection via X-Internal-Token

Since the Hugging Face Space is exposed as a public HTTP endpoint, anyone who knows the Space URL could theoretically call the endpoints directly without going through the bot. To close this gap, every request from this repo to `hf-space` automatically includes an `X-Internal-Token` header.

- **Token source on the bot side**: the `INTERNAL_TOKEN` environment variable in `.env`.
- The value must **exactly match** the `INTERNAL_TOKEN` configured on `hf-space` (as a Secret in its settings), otherwise all requests return `401 Unauthorized`.
- **All** commands calling `hf-space` go through `utils/hfClient.js` (a single point that reads `HF_SPACE_URL`/`INTERNAL_TOKEN` from the environment only, with no URL or placeholder hard-coded in the code): `cmds/chess.js`, `cmds/fb.js`, `cmds/gemini.js`, `cmds/groq.js`, `cmds/manga.js`, `cmds/novel.js`, `cmds/pin.js`, `cmds/song.js`, `cmds/sub.js` (`manga`/`novel`/`pin` only call it as one of several fallback providers, not exclusively).

Usage pattern:
```js
const http = require("./utils/fetchHttp"); // fetch-based axios replacement
const { getHfBase, getInternalToken } = require("./utils/hfClient");
http.post(`${getHfBase()}/endpoint`, payload,
  { headers: { "Content-Type": "application/json", "X-Internal-Token": getInternalToken() } });
```

---

## 🧩 SunkenBot — This Repo's Details

A bun bot that runs as a **userbot** inside Facebook Messenger groups, via a **locally modified and vendored** copy of `fca-unofficial` (located in `vendor/fca-unofficial`, not an npm dependency) — an internal, private version with auto-update disabled (`autoUpdate: false` in `fca-config.json`).

> ⚠️ **Reminder**: unofficial login violates Facebook's Terms of Service in itself — always use a dedicated bot account, never your personal account.

### Key protections in this version

- **A separate send queue per conversation** (`gatedSend` in `utils/safeSend.js`, with a 350ms minimum gap between consecutive messages to the same `threadID`) — instead of one global queue, so a message in one conversation doesn't wait on unrelated messages in other conversations.
- Every `api.sendMessage` call automatically goes through this queue (via `wrapApiForSafety` wrapping `api`), even if a given command forgets to use it explicitly.
- **Human-behavior simulation** (`utils/bot-enhancer.js` + `utils/humanizer.js`): a "thinking" delay and typing indicator scaled to the length of the incoming message and the reply, before actually sending.
- **Per-user, per-command cooldown**, configured via `config.countDown` in each command file (defaults to 3 seconds if not specified).
- **A 5-level permission system**: developers (4) → admins (3) → moderators (2) → VIPs (1) → everyone (0), configured via `config.json` (`developers`, `admins`, `moderators`, `vips`).
- `usersData`/`globalData` linked to MongoDB via Mongoose (optional, via `MONGO_URI`) — without it, data stays in-memory only with no persistence; writes are batched every 5 minutes instead of on every interaction to reduce load on the database.
- **Automatic login session (AppState) refresh every 2 hours**, saved immediately (see session section below).
- **Internal TTL cache** (`utils/cache.js`) reduces repeated expensive external requests (YouTube search, text translation...).
- Periodic cleanup every 30 minutes (expired replies, expired cooldowns, idle conversation queues, orphaned temp files in the system temp folder).

### Recent internal cleanup (worth knowing if you're maintaining this)

- `index.js` was split: rate-limited sending, permissions/cooldowns, temp-file cleanup, session-state saving, and the HTTP server each moved to their own file under `utils/`/`server/` (see Project Structure below). Behavior is unchanged — this was a pure reorganization.
- Duplicate commands were merged into one with automatic fallback between backends: `yt`/`yt2`/`ydl` → `yt`, `pin`/`pinterest` → `pin`, `manga`/`manga2` → `manga`, `novel`/`novel2` → `novel`. The old names still work as aliases.
- `vendor/fca-unofficial` was mechanically de-transpiled (TypeScript→CommonJS boilerplate replaced with plain ESM `export`/`import`) — ~23% smaller, verified behavior-identical against the original via a full export-surface + functional snapshot comparison. No protocol logic (auth, MQTT, etc.) was touched.

---

## ⚙️ Environment Variables

| Variable | Purpose | Required |
|---|---|---|
| `FB_EMAIL` | Facebook account email (fallback login) | Only if not using `APPSTATE` |
| `FB_PASSWORD` | Facebook account password (fallback login) | Only if not using `APPSTATE` |
| `APPSTATE` | JSON session cookie — preferred login method | Recommended |
| `APPSTATE_BOT1` | Alternative session cookie (same format as `APPSTATE`) | Alternative to `APPSTATE` |
| `MONGO_URI` | MongoDB connection string for persistent data storage | Optional (in-memory fallback) |
| `HF_SPACE_URL` | Base URL of the `hf-space` backend (FastAPI on Hugging Face) | Required for AI/media commands |
| `INTERNAL_TOKEN` | Shared secret sent as `X-Internal-Token` to `hf-space` | Required for AI/media commands |
| `CEREBRAS_API_KEY` | Cerebras API key used by the `gpt` command | Required for `gpt` command |
| `GROQ_API_KEY` | Groq API key used by the `groq` and `word` commands | Required for `groq`/`word` commands |
| `GROQ_MODEL` | Groq model name override (defaults to `llama-3.1-8b-instant`) | Optional |
| `FB_GRAPH_ACCESS_TOKEN` | Facebook Graph API token for UID resolution in `adduser`/`uid` | Optional (fallback to scraping) |
| `RAPIDAPI_KEY` | RapidAPI key for UID lookup fallback in `adduser`/`uid` | Optional |
| `FERDEV_API_KEY` | FerDev API key for direct Pinterest image fetching in `pin` | Optional (HF bridge used first) |
| `TUMBLR_API_KEY` | Tumblr API key used by the `random` command | Required for `random` command |
| `PORT` | HTTP server port (defaults to `10000`) | Optional |
| `RENDER_EXTERNAL_URL` | Service URL for self-ping keep-alive on Render | Optional |


---

## 🚀 Deploying on Render

> Render natively supports Bun — no custom buildpacks needed.

### 1 — Push your repo to GitHub

Make sure `vendor/fca-unofficial` and all source files are committed. Do **not** commit `appstate.json`, `.env`, or `node_modules/`.

A minimal `.gitignore`:
```
node_modules/
.env
appstate.json
*.log
```

### 2 — Create a new Web Service on Render

1. Go to [render.com](https://render.com) → **New → Web Service**
2. Connect your GitHub repo
3. Fill in the service settings:

| Field | Value |
|---|---|
| **Runtime** | Node (Render auto-detects Bun from `engines.bun` in `package.json`) |
| **Build Command** | `bun install` |
| **Start Command** | `bun --smol index.js` |
| **Instance Type** | Free (or Starter for persistent uptime) |

### 3 — Add Environment Variables

In **Settings → Environment**, add every variable listed in the table above. At minimum:

```
APPSTATE          = <paste your Facebook session JSON here>
HF_SPACE_URL      = https://your-hf-space.hf.space
INTERNAL_TOKEN    = your_shared_secret
MONGO_URI         = mongodb+srv://user:pass@cluster.mongodb.net/dbname
RENDER_EXTERNAL_URL = https://your-service-name.onrender.com
```

> **How to get `APPSTATE`**: log in once locally (`bun index.js`), then copy the content of the generated `appstate.json` file and paste it as the value of this variable. The bot reads it at startup and saves refreshed sessions back to disk automatically every 2 hours.

### 4 — Deploy and keep alive

Click **Deploy**. The first build installs dependencies and starts the bot. Check the live logs tab to confirm `✅ Logged in successfully`.

On the **Free tier** Render spins down services after 15 minutes of no HTTP traffic. The bot handles this automatically: if `RENDER_EXTERNAL_URL` is set, it pings itself every 14 minutes via the internal keep-alive loop — no external cron or UptimeRobot needed.

### 5 — Updating

```bash
git add .
git commit -m "update"
git push
```

Render auto-deploys on every push to your default branch. The service restarts cleanly; Facebook sessions are preserved because the `appstate.json` written to disk during the previous run is **not** part of git (and Render's ephemeral filesystem loses it on redeploy). **This means you may need to set `APPSTATE` again after major deploys** if the session expires — or mount a persistent disk and point `SESSION_FILE_PATH` at it.

---

## 🚫 Ban List (groups & users the bot must never work for)

`config.json` has two arrays, empty by default:

```json
"bannedGroups": [],
"bannedUsers": []
```

- **`bannedGroups`**: Facebook group thread IDs (GID). If a group's ID is in this list, the bot **does nothing at all** there — no command execution, no `onChat` auto-detection (e.g. `autodl`'s link auto-download), no reactions. Not even a "you're banned" reply is sent; the bot behaves as if it isn't in the group.
- **`bannedUsers`**: Facebook user IDs (UID). If a user's ID is in this list, the bot ignores everything from that user **in every group and DM**, regardless of their role (even a developer/admin ID in this list is ignored).

This is enforced in a single place: the main event-dispatch loop in `index.js` (right where the realtime `listenMqtt` events come in), before the event is routed to any handler — so there's exactly one code path to check when auditing this, and no command or event handler can accidentally bypass it.

**Managing the list without editing JSON by hand:** the `ban` command (`role: 3`, admins/developers only) adds/removes IDs and applies the change immediately (no restart needed):

```
.حظر مجموعة <GID>          — ban a group (or run with no GID inside the group itself)
.حظر مستخدم <UID>          — ban a user everywhere
.حظر الغاء مجموعة <GID>    — unban a group
.حظر الغاء مستخدم <UID>    — unban a user
.حظر قائمة                 — list everything currently banned
```

Use `gid`/`uid` to find the IDs you need first. Note: since a banned group is fully ignored, you can't unban a group with a command sent *from inside that group* — run `حظر الغاء مجموعة` from elsewhere (a DM to the bot, or another group), or edit `config.json` directly and restart.

---

## 🗂️ Project Structure

```
ss-main/
├── cmds/          # Individual command files (one file per command)
├── db/            # Mongoose schema + connection helper
├── server/
│   └── webServer.js      # Health-check HTTP server + YouTube HTTP routes
├── utils/         # Shared helpers: cache, http client, humanizer,
│                  # safeSend (rate-limited sending), roles (permissions/cooldowns),
│                  # banList (ban-list enforcement), tempCleanup, sessionState, etc.
├── vendor/
│   └── fca-unofficial/   # Vendored, locally modified Facebook Chat API library
├── config.json    # Runtime config (permission lists, ban list, prefix, bot name)
├── fca-config.json
├── index.js       # Entry point: login, event loop, command routing, safety wrappers
└── package.json
```

---

## 🧱 Adding a New Command

Every file in `cmds/` is auto-loaded on startup (and on `up` hot-reload). Drop a new `.js` file there and it's live — **no changes to `index.js` needed**.

---

### Step 1 — Create the file

```
cmds/mycommand.js
```

Name it exactly after your command's `name` field (lowercase, no spaces).

---

### Step 2 — Full template (copy-ready)

The template below is the `redditrandom` command stripped to a skeleton. Every field and pattern used here is already in production.

```js
"use strict";

// ── imports ──────────────────────────────────────────────────────────────────
// Use "fs-extra" (already in package.json) instead of the bare "fs" module.
import fs from "fs-extra";
import path from "path";
import { mkdir, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { randomUUID } from "node:crypto";

// ── constants ─────────────────────────────────────────────────────────────────
// Store temp files under a named subfolder inside downloads/ so cleanup is
// scoped and never touches other commands' files.
const TMP_DIR = path.join(process.cwd(), "downloads", "mycommand");

// ── helpers ───────────────────────────────────────────────────────────────────
// Keep pure helpers outside onStart — easier to test and re-use.

/** Pick a random element from an array. */
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Delete a file without throwing if it's already gone. */
async function silentDelete(filePath) {
  try { await unlink(filePath); } catch {}
}

/**
 * Download a remote URL to a local path.
 * Streams directly to disk — never loads the whole file into memory.
 */
async function downloadFile(url, outPath) {
  const res = await fetch(url, { headers: { "User-Agent": "SunkenBot/1.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} while downloading`);
  await pipeline(res.body, createWriteStream(outPath));
}

// ── main logic ────────────────────────────────────────────────────────────────
// If your command needs to call an external API, put that call in a dedicated
// async function here, not inline inside onStart.

async function fetchSomething(param) {
  const res = await fetch(`https://example.com/api?q=${encodeURIComponent(param)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  // validate before returning
  if (!json?.result) throw new Error("No data in response");
  return json.result;
}

// ── command export ────────────────────────────────────────────────────────────
export default {
  config: {
    name: "mycommand",           // primary trigger — must be unique across cmds/
    aliases: ["alias1", "م"],    // Arabic aliases work fine here
    version: "1.0.0",
    author: "Sunken",
    role: 0,                     // 0=everyone  1=VIP  2=mod  3=admin  4=dev
    countDown: 5,                // per-user cooldown in seconds — NEVER 0 for API calls
    category: "أدوات عامة",     // shown in the help menu
    description: "Short Arabic description shown in .help",
    usage: [
      "{pn}mycommand — basic usage",
      "{pn}mycommand <arg> — with argument",
    ],
  },

  onStart: async ({ api, event, args, message }) => {
    const { threadID, messageID, senderID } = event;

    // ── 1. validate args early ────────────────────────────────────────────
    // Fail fast so the rest of the handler can assume clean input.
    const query = args.join(" ").trim();
    if (!query) {
      return global.safeSend(api, "❌ أدخل نصاً.", threadID, null, messageID);
    }

    try {
      // ── 2. fetch data ─────────────────────────────────────────────────
      const result = await fetchSomething(query);

      // ── 3a. text-only reply ───────────────────────────────────────────
      // Use global.safeSend (rate-limited) for plain text.
      // Always pass null before messageID so the reply is quoted correctly.
      return global.safeSend(api, `✅ ${result}`, threadID, null, messageID);

      // ── 3b. file attachment ───────────────────────────────────────────
      // Use api.sendMessage directly when sending an attachment + caption.
      // global.safeSend doesn't support the { body, attachment } form.
      /*
      await mkdir(TMP_DIR, { recursive: true });
      const filePath = path.join(TMP_DIR, `${randomUUID().slice(0, 8)}.mp4`);
      await downloadFile(result.fileUrl, filePath);

      await new Promise((resolve, reject) => {
        api.sendMessage(
          { body: `✅ ${result.caption}`, attachment: fs.createReadStream(filePath) },
          threadID,
          (err) => (err ? reject(err) : resolve()),
          messageID,
        );
      });

      await silentDelete(filePath);
      */

    } catch (err) {
      // Always catch and surface a clean Arabic error — never let it crash silently.
      return global.safeSend(
        api,
        `❌ خطأ: ${err?.message || err}`,
        threadID,
        null,
        messageID,
      );
    }
  },
};
```

---

### Context object — what you get in `onStart`

| Property | Type | Notes |
|---|---|---|
| `api` | object | Full fca-unofficial API instance |
| `event` | object | `threadID`, `messageID`, `senderID`, `body`, `type`, `messageReply`, `attachments` |
| `args` | `string[]` | Words after the command name, already split on whitespace |
| `message` | object | `message.reply(text)` · `message.unsend(msgID)` · `message.registerReply(...)` |

---

### Common patterns

**Plain quoted reply**
```js
// null in position 3 is required — it's the callback slot; omitting it breaks quoting.
global.safeSend(api, "مرحباً!", threadID, null, messageID);
```

**Send a spinner, then edit it**
```js
const sent = await new Promise((res, rej) =>
  api.sendMessage("⏳ جاري المعالجة...", threadID,
    (err, info) => (err ? rej(err) : res(info)), messageID)
);
// ... do async work ...
await api.editMessage("✅ تم!", sent.messageID);
// editMessage takes 2 args only — no threadID.
```

**Send a file with a caption (both in one message)**
```js
import fs from "fs-extra";

await new Promise((resolve, reject) => {
  api.sendMessage(
    { body: "📎 الكابشن هنا", attachment: fs.createReadStream("/tmp/file.mp4") },
    threadID,
    (err) => (err ? reject(err) : resolve()),
    messageID,
  );
});
```

> ⚠️ `global.safeSend` does **not** accept `{ body, attachment }`. Use `api.sendMessage` directly whenever you're sending a file.

**Register a follow-up reply listener**
```js
message.registerReply(
  sent.messageID,
  { author: senderID },            // only the original sender can continue
  async ({ api, event }) => {
    const answer = event.body.trim();
    api.sendMessage(`قلت: ${answer}`, event.threadID, null, event.messageID);
  }
);
```

**Call the HF-Space backend**
```js
import { getHfBase, getInternalToken } from "../utils/hfClient.js";
import http from "../utils/fetchHttp.js";

const { data } = await http.post(
  `${getHfBase()}/your-endpoint`,
  { param: value },
  { headers: {
      "Content-Type": "application/json",
      "X-Internal-Token": getInternalToken(),
  }},
);
```

**React to a message**
```js
// type: "❤️" | "😆" | "😮" | "😢" | "😠" | "👍" | "👎"
await api.setMessageReaction("❤️", messageID, () => {}, true);
```

**`onChat` — fires on every message (use sparingly)**
```js
onChat: async ({ api, event }) => {
  // Runs before cooldown checks — implement your own rate-limiting if needed.
  if (event.body?.toLowerCase() === "ping") {
    api.sendMessage("pong", event.threadID);
  }
},
```

---

### Role levels

| `role` | Who can use it |
|---|---|
| `0` | Everyone |
| `1` | VIP + above |
| `2` | Moderators + above |
| `3` | Admins + above |
| `4` | Developers only |

Roles are managed in `config.json` under `developers`, `admins`, `moderators`, `vips`.

---

### Checklist before dropping the file into `cmds/`

- [ ] `name` is unique — verify with `.help all` after hot-reload (`up`)
- [ ] `role` is the **minimum** needed, not `4` by default
- [ ] `countDown` is **not** `0` for any command that hits an external API or downloads a file
- [ ] Every `sendMessage` uses the 4-argument form: `(body, threadID, null, messageID)`
- [ ] Every `editMessage` uses the 2-argument form: `(text, messageID)` — no `threadID`
- [ ] Every `unsendMessage` includes `threadID`: `(messageID, threadID)`
- [ ] Temp files are deleted in a `finally` block or via `silentDelete` after send
- [ ] The `catch` block sends a readable Arabic error — never silently swallows exceptions
- [ ] `global.safeSend` is used for plain text; `api.sendMessage` is used when sending `{ body, attachment }`
