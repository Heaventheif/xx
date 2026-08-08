import http from "../utils/fetchHttp";
import { Readable } from "stream";

// ── رابط فضاء HuggingFace ──────────────────────────────────────────────────
const HF_BASE        = "https://kiyunhai-s.hf.space";
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN ?? "";   // اختياري

const CHESS_TIMEOUT = 55000;

const activeGames = new Map();

// ── جلب اسم المستخدم الحقيقي من Facebook ──────────────────────────────────
async function getUserName(api, userID) {
  if (userID === "bot") return "🤖 البوت";
  try {
    return await new Promise((resolve, reject) => {
      api.getUserInfo(userID, (err, info) => {
        if (err || !info?.[userID]) return reject(err || new Error("no info"));
        const u = info[userID];
        resolve(u.name || u.fullName || `${u.firstName || ""} ${u.lastName || ""}`.trim() || String(userID).slice(-4));
      });
    });
  } catch {
    return String(userID).slice(-4);
  }
}

// Get the MongoDB collection for chess games, if a DB is configured.
async function getCol() {
  if (!global.db) return null;
  try { return global.db.db("chess_games"); } catch { return null; }
}

// Find the active chess game for a player in a thread (DB or in-memory).
async function findActiveGame(threadID, playerID) {
  const col = await getCol();
  if (col) {
    try {
      return await col.findOne({
        threadID,
        status: "active",
        $or: [{ player_white: playerID }, { player_black: playerID }]
      });
    } catch (e) { console.warn("[CHESS DB]", e.message); }
  }
  for (const [, g] of activeGames) {
    if (g.threadID === threadID && g.status === "active" &&
      (g.player_white === playerID || g.player_black === playerID)) return g;
  }
  return null;
}

// Create and persist a new chess game.
async function createGame(data) {
  data.status = "active";
  data.createdAt = new Date().toISOString();
  const col = await getCol();
  if (col) {
    try {
      const r = await col.insertOne(data);
      data._id = r.insertedId.toString();
      return data;
    } catch (e) { console.warn("[CHESS DB]", e.message); }
  }
  const id = `${data.threadID}_${Date.now()}`;
  data._id = id;
  activeGames.set(id, { ...data });
  return data;
}

// Apply updates to an existing chess game.
async function updateGame(gameId, updates) {
  const col = await getCol();
  if (col) {
    try {
      const { ObjectId } = (await import("mongoose")).Types;
      let filter;
      try { filter = { _id: new ObjectId(gameId) }; }
      catch { filter = { _id: gameId }; }
      await col.updateOne(filter, { $set: updates });
      return;
    } catch (e) { console.warn("[CHESS DB]", e.message); }
  }
  const g = activeGames.get(String(gameId));
  if (g) activeGames.set(String(gameId), { ...g, ...updates });
}

// Mark a game as completed with an optional winner.
async function endGame(gameId, winnerId = null) {
  await updateGame(gameId, {
    status: "completed",
    winner: winnerId,
    endedAt: new Date().toISOString()
  });
}

// Send a move to the chess engine API and get the resulting position.
// perspective: "white" | "black" — determines which side the board is rendered from.
async function callChessEngine(fen, move, botMode = false, difficulty = DEFAULT_DIFFICULTY, perspective = "white") {
  const url = `${HF_BASE}/process_move`;
  const res = await http.post(url,
    { fen, move: move || null, bot_mode: botMode, difficulty, perspective },
    {
      timeout: CHESS_TIMEOUT,
      headers: {
        "Content-Type": "application/json",
        ...(INTERNAL_TOKEN ? { "X-Internal-Token": INTERNAL_TOKEN } : {}),
      }
    }
  );
  return res.data;
}

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const DEFAULT_DIFFICULTY = 10;

// Normalize a raw move string (remove spaces, lowercase).
function normalizeMove(text) {
  return text.replace(/\s+/g, "").toLowerCase();
}

// Check whether a text looks like a valid UCI chess move.
function isChessMove(text) {
  return /^[a-h][1-8][a-h][1-8][qrbnQRBN]?$/.test(normalizeMove(text));
}

// Convert an SVG board image to PNG, if the renderer is available.
async function svgToPngBuffer(svgBuf) {
  try {
    const { Resvg } = await import("@resvg/resvg-js");
    const resvg = new Resvg(svgBuf);
    return resvg.render().asPng();
  } catch {
    return null;
  }
}

// Send the board image (PNG if possible, else SVG) with a caption.
async function sendBoardImage(api, threadID, messageID, imageBase64, caption) {
  try {
    const svgBuf = Buffer.from(imageBase64, "base64");
    const pngBuf = await svgToPngBuffer(svgBuf);

    const buf       = pngBuf || svgBuf;
    const extension = pngBuf ? "png" : "svg";

    const stream = Readable.from(buf);
    stream.path  = `chess_board.${extension}`;
    await new Promise((res, rej) =>
      global.safeSend(api,
        { body: caption, attachment: stream },
        threadID,
        (err, info) => err ? rej(err) : res(info),
        messageID
      )
    );
  } catch {
    global.safeSend(api, caption + "\n⚠️ (تعذّر إرسال الصورة)", threadID, null, messageID);
  }
}

// الصورة وصلت بالفعل PNG من HuggingFace — لا حاجة لتحويل
async function sendBoardImageDirect(api, threadID, messageID, imageBase64, caption) {
  try {
    const buf    = Buffer.from(imageBase64, "base64");
    const stream = Readable.from(buf);
    stream.path  = "chess_board.png";
    await new Promise((res, rej) =>
      global.safeSend(api,
        { body: caption, attachment: stream },
        threadID,
        (err, info) => err ? rej(err) : res(info),
        messageID
      )
    );
  } catch {
    global.safeSend(api, caption + "\n⚠️ (تعذّر إرسال الصورة)", threadID, null, messageID);
  }
}

const CHESS_RULES =
`♟️ قواعد بوت الشطرنج الرسومي
━━━━━━━━━━━━━━━━━━━━━━━━━

🚀 بدء لعبة:
  chess bot      — ضد الذكاء الاصطناعي
  chess @شخص     — تحدي عضو في المجموعة
  ردّ على رسالة + chess — تحدي صاحبها
  ⚡ الألوان تُحدَّد عشوائياً عند البدء

🎮 كيف تكتب النقلة (نظام UCI):
  من أين + إلى أين (بمسافة أو بدونها)
  ✅ e2e4   ✅ E2 E4   ✅ e2 e4  (كلها مقبولة)

♟️ النقلات الخاصة:
  • التبييت القصير ← e1g1 (ملك أبيض)
                      e8g8 (ملك أسود)
  • التبييت الطويل ← e1c1 (ملك أبيض)
                      e8c8 (ملك أسود)
  • الأخذ بالتجاوز ← تلقائي (اكتب النقلة العادية)
  • ترقية البيدق:
      e7e8q  — وزير  ♛ (الأقوى، افتراضي)
      e7e8r  — قلعة  ♜
      e7e8b  — فيل   ♝
      e7e8n  — حصان  ♞
    (بدون حرف = ترقية تلقائية لوزير)

⚠️ أثناء اللعبة:
  resign     — استسلام فوري
  chess help — عرض هذه القواعد مجدداً

📌 ملاحظات:
  • لا يمكن بدء لعبتين في نفس الوقت
  • النقلات غير القانونية تُرفض بصمت
  • في لعبة البوت: يرد تلقائياً بعد كل نقلتك`;

export default {
  config: {
    name: "chess",
    aliases: ["شطرنج"],
    version: "2.1.0",
    author: "Sunken",
    countDown: 5,
    role: 0,
    category: "ألعاب وترفيه",
    description: "بوت شطرنج رسومي للمجموعات (ضد لاعب أو ضد البوت)",
    usage: [
      "{pn}chess bot — بدء مباراة ضد الذكاء الاصطناعي",
      "{pn}chess @شخص — تحدي لاعب عبر منشن",
      "رد على رسالة + {pn}chess — تحدي صاحب الرسالة",
      "e2e4 (أو أي نقلة صحيحة) — تُلعب تلقائياً أثناء مباراة نشطة، بلا أمر",
      "resign / استسلام — الاستسلام من المباراة الحالية",
      "{pn}chess help — عرض القواعد الكاملة والنقلات الخاصة",
    ],
  },


  // Handle chat messages: chess help, resign, or an in-progress move.
  onChat: async function ({ api, event }) {
    const { threadID, senderID, body, messageID } = event;
    if (!body?.trim()) return;
    const raw  = body.trim();
    const text = raw.toLowerCase().trim();


    if (text === "chess help" || text === "شطرنج مساعدة") {
      return global.safeSend(api, CHESS_RULES, threadID, null, messageID);
    }


    if (text === "resign" || text === "استسلام") {
      const game = await findActiveGame(threadID, senderID);
      if (!game) return;
      const isWhite    = game.player_white === senderID;
      const winnerId   = isWhite ? game.player_black : game.player_white;
      await endGame(game._id, winnerId);
      const winnerLabel = await getUserName(api, winnerId);
      return global.safeSend(api,
        `🏳️ استسلم اللاعب!\n🏆 الفائز: ${winnerLabel}`,
        threadID, null, messageID
      );
    }


    if (!isChessMove(raw)) return;
    const move = normalizeMove(raw);


    const game = await findActiveGame(threadID, senderID);
    if (!game) return;


    if (game.current_turn !== senderID) return;


    const isBotGame = game.player_black === "bot" || game.player_white === "bot";


    let result;
    try {
      // الرقعة تُعرض دائماً من منظور اللاعب البشري
      const humanID = isBotGame
        ? (game.player_white === "bot" ? game.player_black : game.player_white)
        : senderID;
      const perspective = game.player_white === humanID ? "white" : "black";
      result = await callChessEngine(game.fen, move, isBotGame, game.difficulty || DEFAULT_DIFFICULTY, perspective);
    } catch (err) {
      return global.safeSend(api,
        `⚠️ فشل الاتصال بسيرفر الشطرنج\n${err.message?.substring(0, 80)}`,
        threadID, null, messageID
      );
    }


    if (result.illegal_move_error) {
      return global.safeSend(api, result.illegal_move_error, threadID, null, messageID);
    }


    if (result.game_over) {
      let winnerId = null;
      if (result.winner) {
        const winnerIsWhite =
          result.winner === "أبيض" ||
          result.winner === "white" ||
          result.winner.toLowerCase().includes("white") ||
          result.winner.includes("أبيض");
        winnerId = winnerIsWhite ? game.player_white : game.player_black;
      }
      await endGame(game._id, winnerId);
    } else {
      // في لعبة البوت: الدور يبقى دائماً على اللاعب البشري (البوت لعب بالفعل في نفس الاستدعاء)
      // في لعبة اللاعبَين: يتبادل الدور
      const nextTurn = isBotGame
        ? senderID
        : (game.current_turn === game.player_white
            ? game.player_black
            : game.player_white);
      await updateGame(game._id, { fen: result.new_fen, current_turn: nextTurn });
    }


    let caption;
    if (result.game_over) {
      if (result.winner) {
        const winnerIsWhite =
          result.winner === "أبيض" ||
          result.winner.toLowerCase().includes("white") ||
          result.winner.includes("أبيض");
        const winnerId    = winnerIsWhite ? game.player_white : game.player_black;
        const winnerLabel = await getUserName(api, winnerId);
        caption = `♟️ كش مات!\n🏆 الفائز: ${winnerLabel}`;
      } else {
        caption = "🤝 تعادل!";
      }
    } else {
      const isPromo      = move.length === 5;
      const promoLabels  = { q: "وزير ♛", r: "قلعة ♜", b: "فيل ♝", n: "حصان ♞" };
      const promoNote    = isPromo ? `\n⬆️ ترقية إلى ${promoLabels[move[4]] || "وزير ♛"}` : "";

      if (isBotGame) {
        caption =
          `✅ نقلتك: ${move.toUpperCase()}${promoNote}\n` +
          `🤖 البوت لعب — دورك الآن!`;
      } else {
        const nextTurnId  = game.current_turn === game.player_white
          ? game.player_black : game.player_white;
        const nextLabel   = await getUserName(api, nextTurnId);
        caption = `✅ نقلة: ${move.toUpperCase()}${promoNote}\n🎯 دور: ${nextLabel}`;
      }
    }

    await sendBoardImageDirect(api, threadID, messageID, result.image_base64, caption);
  },

  // Command entry point: start a new game against the bot or another player.
  onStart: async function ({ api, event, args }) {
    const { threadID, senderID, messageID, mentions, messageReply } = event;
    const joinedArgs = args.join(" ").toLowerCase().trim();

    if (["help", "مساعدة", "قواعد"].includes(joinedArgs)) {
      return global.safeSend(api, CHESS_RULES, threadID, null, messageID);
    }


    if (!joinedArgs && !messageReply && !Object.keys(mentions || {}).length) {
      return global.safeSend(api,
        "♟️ بوت الشطرنج\n\n" +
        "  chess bot   — ضد الذكاء الاصطناعي\n" +
        "  chess @شخص  — ضد لاعب\n" +
        "  رد + chess  — تحدي صاحب الرسالة\n" +
        "  chess help  — القواعد والنقلات الخاصة",
        threadID, null, messageID
      );
    }


    const existingGame = await findActiveGame(threadID, senderID);
    if (existingGame) {
      return global.safeSend(api,
        "⚠️ لديك مباراة نشطة!\nاكتب resign لإنهائها أولاً.",
        threadID, null, messageID
      );
    }


    let opponentID    = null;
    let opponentLabel = "";
    let difficulty    = DEFAULT_DIFFICULTY;

    const botMatch = joinedArgs.match(/^(bot|بوت)$/);

    if (botMatch) {
      opponentID = "bot";
      opponentLabel = "🤖 البوت";

    } else if (Object.keys(mentions || {}).length > 0) {
      opponentID    = Object.keys(mentions)[0];
      opponentLabel = await getUserName(api, opponentID);

    } else if (messageReply) {
      opponentID = messageReply.senderID;
      if (!opponentID || opponentID === senderID)
        return global.safeSend(api, "❌ لا يمكنك تحدي نفسك!", threadID, null, messageID);
      opponentLabel = await getUserName(api, opponentID);

    } else {
      return global.safeSend(api,
        "❌ حدد منافسك:\n  chess bot — ضد البوت\n  chess @شخص — ضد لاعب",
        threadID, null, messageID
      );
    }


    if (opponentID !== "bot") {
      const oppGame = await findActiveGame(threadID, opponentID);
      if (oppGame)
        return global.safeSend(api, "⚠️ هذا اللاعب لديه مباراة نشطة بالفعل!", threadID, null, messageID);
    }


    const senderIsWhite = Math.random() < 0.5;
    const player_white  = senderIsWhite ? senderID    : opponentID;
    const player_black  = senderIsWhite ? opponentID  : senderID;

    let first_turn = player_white;

    const senderColor   = senderIsWhite ? "⬜ أبيض" : "⬛ أسود";
    const opponentColor = senderIsWhite ? "⬛ أسود" : "⬜ أبيض";
    const senderLabel   = await getUserName(api, senderID);


    const game = await createGame({
      threadID,
      player_white,
      player_black,
      current_turn: first_turn,
      fen: STARTING_FEN,
      difficulty,
    });


    let startFen         = STARTING_FEN;
    let startImageB64    = null;
    let botOpeningNote   = "";

    if (opponentID === "bot" && player_white === "bot") {
      try {
        const botRes = await callChessEngine(STARTING_FEN, null, true, difficulty, "black");
        startFen      = botRes.new_fen;
        startImageB64 = botRes.image_base64;
        botOpeningNote = "\n🤖 البوت فتح اللعبة — دورك الآن!";
        await updateGame(game._id, { fen: startFen, current_turn: senderID });
      } catch (e) {
        const detail = e.response?.data?.detail || e.message;
        console.warn("[CHESS] نقلة البوت الأولى فشلت:", detail);
        await updateGame(game._id, {
          status: "aborted",
          abortReason: detail,
          endedAt: new Date().toISOString(),
        });
        await global.safeSend(
          api,
          `⚠️ تعذّر بدء اللعبة — فشل البوت في لعب النقلة الأولى.\n${String(detail).substring(0, 150)}\nحاول مرة أخرى بعد قليل.`,
          threadID, null, messageID
        );
        return;
      }
    } else {
      try {
        // الرقعة تُعرض من منظور اللاعب البشري دائماً
        const humanID = opponentID === "bot"
          ? senderID
          : senderID; // في لعبة اللاعبَين: من منظور من بدأ اللعبة
        const senderPerspective = game.player_white === humanID ? "white" : "black";
        const r = await callChessEngine(STARTING_FEN, null, false, DEFAULT_DIFFICULTY, senderPerspective);
        startImageB64 = r.image_base64;
      } catch (e) {
        console.warn("[CHESS] فشل صورة البداية:", e.response?.data?.detail || e.message);
      }
    }


    const firstLabel = player_white === "bot"
      ? "🤖 البوت (لعب بالفعل)"
      : await getUserName(api, player_white);

    const caption =
      `♟️ بدأت مباراة شطرنج!\n\n` +
      `${senderColor}: ${senderLabel}\n` +
      `${opponentColor}: ${opponentLabel}\n\n` +
      `🎯 يبدأ: ${firstLabel}${botOpeningNote}\n` +
      (opponentID === "bot" && player_white !== "bot"
        ? "🤖 البوت سيرد تلقائياً بعد كل نقلتك\n"
        : "") +
      `\n💡 chess help — لمعرفة النقلات الخاصة`;

    if (startImageB64) {
      await sendBoardImageDirect(api, threadID, messageID, startImageB64, caption);
    } else {
      global.safeSend(api, caption, threadID, null, messageID);
    }
  }
};
