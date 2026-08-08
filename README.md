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
- Duplicate commands were merged into one with automatic fallback between backends (see the Media/Games rows in the table below): `yt`/`yt2`/`ydl` → `yt`, `pin`/`pinterest` → `pin`, `manga`/`manga2` → `manga`, `novel`/`novel2` → `novel`. The old names still work as aliases.
- `vendor/fca-unofficial` was mechanically de-transpiled (TypeScript→CommonJS boilerplate replaced with plain ESM `export`/`import`) — ~23% smaller, verified behavior-identical against the original via a full export-surface + functional snapshot comparison. No protocol logic (auth, MQTT, etc.) was touched.

### Notable commands (based on actual files in `cmds/`)

| Category | Examples |
|---|---|
| AI | `gpt` (Cerebras), `gptx` (GPT-4o via GitHub Models), `groq`, `gemini` (both via `hf-space`) |
| Media & downloads | `yt` (YouTube — tries 3 backends automatically: local engine → yt-dlp-stream → ccproject; replaces the old separate `yt`/`yt2`/`ydl` commands), `sc`, `song` (SoundCloud search by name + sends the first result as an audio file, via `hf-space` — a bridge only, no local library), `tts` (Gemini TTS directly), `pin` (Pinterest — tries the `hf-space` bridge then FerDev directly; replaces the old separate `pin`/`pinterest` commands), `random`, `fb` (Facebook video download via `hf-space`), `comic`, `sub` (adds text subtitles to a video via `hf-space`), `autodl` (auto-detects and downloads links from other platforms — TikTok, Instagram, Twitter, Reddit, Threads — posted in normal chat) |
| Games & content | `chess` (via `hf-space`), `novel` (5 sources in parallel + auto-translation, falls back automatically to a JS-rendered-sites bridge if none have the chapter; replaces the old separate `novel`/`novel2` commands), `quran`, `animal` (cat/dog facts), `manga` (MangaDex, falls back automatically to an alternate source if the chapter isn't available; replaces the old separate `manga`/`manga2` commands) |
| General tools | `help`, `tr` (text translation, several engines with fallback), `uid`, `gid`, `unsend` |
| Admin (moderators/admins) | `kick`, `adduser`, `up` (hot-reload commands + stats), `ban` (manage the ban list — see below) |

> ℹ️ Where a command used to have numbered variants (e.g. `yt2`, `manga2`, `novel2`, `pinterest`) to pick a specific backend, those names still work as aliases on the merged command — they just no longer need to be chosen manually, since the merged command tries every backend automatically and only fails if all of them do.

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

Every file in `cmds/` is auto-loaded on startup (and on `up` hot-reload). Drop a new `.js` file there and it's live — no changes to `index.js` needed.

### Minimal template

```js
// cmds/mycommand.js
export default {
  config: {
    name: "mycommand",          // primary trigger word (must be unique)
    aliases: ["alias1", "م"],   // optional alternative names (Arabic aliases work)
    role: 0,                    // 0=everyone  1=VIP  2=mod  3=admin  4=dev
    countDown: 5,               // per-user cooldown in seconds (0 = no cooldown)
    category: "أدوات عامة",    // shown in help menu
    description: "What this command does",
    usage: ["{pn}mycommand <arg> — example"],
  },

  // Runs when someone types the command name (or an alias).
  onStart: async ({ api, event, args, message }) => {
    const { threadID, messageID, senderID } = event;

    if (!args.length) {
      // Always pass null before messageID so the reply is quoted correctly.
      return api.sendMessage("❌ أدخل نصاً.", threadID, null, messageID);
    }

    const text = args.join(" ");
    return api.sendMessage(`✅ ${text}`, threadID, null, messageID);
  },
};
```

### Context object — what you get in handlers

| Property | Type | Description |
|---|---|---|
| `api` | object | The full fca-unofficial API |
| `event` | object | Raw event: `threadID`, `messageID`, `senderID`, `body`, `type`, `messageReply`, `attachments` |
| `args` | string[] | Words after the command name, already split on spaces |
| `message` | object | Convenience wrapper: `message.reply(text)` · `message.unsend(msgID)` · `message.registerReply(...)` |

### Common patterns

**Send a plain reply (quoted)**
```js
api.sendMessage("Hello!", threadID, null, messageID);
```

**Send while showing a spinner, then edit it**
```js
const sent = await new Promise((res, rej) =>
  api.sendMessage("⏳ جاري المعالجة...", threadID,
    (err, info) => err ? rej(err) : res(info), messageID)
);
// ... do your async work ...
await api.editMessage("✅ تم!", sent.messageID);
```

**Send a file attachment**
```js
import fs from "fs-extra";
api.sendMessage(
  { body: "Here you go", attachment: fs.createReadStream("/tmp/file.mp4") },
  threadID, null, messageID
);
```

**Register a follow-up reply listener** (user must reply to the bot's message to continue)
```js
message.registerReply(
  sent.messageID,
  { author: senderID },          // only the original sender can continue
  async ({ api, event }) => {
    const answer = event.body.trim();
    api.sendMessage(`You said: ${answer}`, event.threadID, null, event.messageID);
  }
);
```

**Call the HF-Space backend** (for AI / media commands)
```js
import { getHfBase, getInternalToken } from "../utils/hfClient.js";
import http from "../utils/fetchHttp.js";

const { data } = await http.post(
  `${getHfBase()}/your-endpoint`,
  { param: value },
  { headers: { "Content-Type": "application/json",
               "X-Internal-Token": getInternalToken() } }
);
```

**Use the per-user cooldown (already automatic)**
`countDown` in config is enforced globally by `index.js` before `onStart` is ever called — you don't need to check it yourself.

### Role levels quick reference

| `role` value | Who can run it |
|---|---|
| `0` | Everyone |
| `1` | VIP users + above |
| `2` | Moderators + above |
| `3` | Admins + above |
| `4` | Developers only |

Roles are configured in `config.json` under `developers`, `admins`, `moderators`, `vips`.

### Optional handler: `onChat`

```js
// Fires on EVERY message in every group — use sparingly.
onChat: async ({ api, event }) => {
  if (event.body?.toLowerCase() === "ping") {
    api.sendMessage("pong", event.threadID);
  }
},
```

> ⚠️ `onChat` runs before cooldown checks. If you need rate-limiting inside it, implement it yourself (e.g. a per-user `Map` tracking last-called time).

### Checklist before submitting a command

- [ ] `name` is unique (check with `.help all`)
- [ ] `role` is the minimum necessary, not `4` by default
- [ ] `countDown` is **not** `0` for commands that hit external APIs or download files
- [ ] All `sendMessage` calls use the 4-argument form: `(text, threadID, null, messageID)`
- [ ] All `editMessage` calls use the 2-argument form: `(text, messageID)` — no threadID
- [ ] All `unsendMessage` calls include threadID: `(messageID, threadID)`
- [ ] Temp files created in `os.tmpdir()` are cleaned up in a `finally` block
