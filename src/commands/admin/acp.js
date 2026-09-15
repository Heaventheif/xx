var M = Object.defineProperty;
var u = (e, a) => M(e, "name", { value: a, configurable: !0 });

import acpUserFactory from "../../../fca-unofficial/lib/external-apis/action/acpUser.js";

const ACP_DEV = String(process.env.DEV || "").trim().toLowerCase() === "on";

function acpDebug(message, details = {}) {
  if (!ACP_DEV) return;

  const safe = { ...details };

  delete safe.raw;
  delete safe.body;
  delete safe.response;
  delete safe.token;
  delete safe.cookie;

  console.error(`[ACP-DEV] ${message}`, safe);
}

function parseFacebookResponse(raw) {
  if (raw && typeof raw === "object") return raw;

  const text = String(raw ?? "")
    .replace(/^for \(;;\);/, "")
    .replace(/^\s*throw[^;]+;/, "")
    .trim();

  try {
    return JSON.parse(text);
  } catch {}

  const records = text
    .split(/\r?\n/)
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  if (records.length === 1) return records[0];

  if (records.length > 1) {
    return { __records: records };
  }

  throw new Error("Facebook returned a non-JSON response");
}

function collectFriendNodes(value, output = [], seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) {
    return output;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      collectFriendNodes(item, output, seen);
    }

    return output;
  }

  const id =
    value.id ??
    value.userID ??
    value.user_id ??
    value.uid;

  const name =
    value.name ??
    value.full_name ??
    value.title;

  if (
    id &&
    name &&
    !String(id).includes(":")
  ) {
    output.push(value);
  }

  for (const child of Object.values(value)) {
    collectFriendNodes(child, output, seen);
  }

  return output;
}

function getAuthContext(api) {
  const botIndex =
    api?.__botIndex ??
    api?.botIndex ??
    1;

  return (
    api?._ctx ||
    api?.ctx ||
    global.__fcaContexts?.get(botIndex) ||
    global.__fcaContexts?.[botIndex] ||
    null
  );
}

const ACCEPT_EMOJI = "✅";
const REJECT_EMOJI = "❌";

const TIMEOUT_MS = 5 * 60 * 1000;

function safeStringify(v) {
  if (v instanceof Error) {
    return v.message;
  }

  if (typeof v === "string") {
    return v;
  }

  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function sendAsync(api, text, threadID, replyTo = null) {
  return new Promise((resolve, reject) => {
    global.safeSend(
      api,
      text,
      threadID,
      (err, msg) => {
        if (err) {
          return reject(err);
        }

        resolve(msg);
      },
      replyTo
    );
  });
}

u(sendAsync, "sendAsync");

function threadTypeLabel(t) {
  return (
    t?.isGroup ||
    t?.threadType === "GROUP"
  )
    ? "👥 مجموعة"
    : "👤 شخص";
}

u(threadTypeLabel, "threadTypeLabel");

function threadDisplayName(t) {
  if (t?.name || t?.threadName) {
    return t.name || t.threadName;
  }

  const ids = Array.isArray(t?.participantIDs)
    ? t.participantIDs
    : [];

  if (ids.length === 1) {
    return `UID: ${ids[0]}`;
  }

  if (ids.length === 2) {
    const bot =
      String(
        global.botApi?.getCurrentUserID?.() ||
        ""
      );

    return `UID: ${
      ids.find(p => String(p) !== bot) ||
      ids[0]
    }`;
  }

  return "[بدون اسم]";
}

u(threadDisplayName, "threadDisplayName");

/* ============================================================
 * طلبات المراسلة
 * ============================================================
 *
 * نجرب مجلدات Facebook المختلفة:
 *
 * PENDING
 * OTHER
 * SPAM
 * UNKNOWN
 *
 * مع إزالة الطلبات المكررة بواسطة threadID.
 */

async function fetchAllPendingRequests(api) {
  const tags = [
    "PENDING",
    "OTHER",
    "SPAM",
    "UNKNOWN"
  ];

  const seen = new Set();
  const combined = [];

  if (typeof api.getThreadList !== "function") {
    throw new Error(
      "api.getThreadList غير متوفر في FCA"
    );
  }

  for (const tag of tags) {
    try {
      const list = await api.getThreadList(
        50,
        null,
        [tag]
      );

      if (!Array.isArray(list)) {
        acpDebug(
          `message-request folder ${tag} returned invalid data`
        );

        continue;
      }

      acpDebug(
        `message-request folder ${tag}`,
        {
          count: list.length
        }
      );

      for (const t of list) {
        const id = String(
          t?.threadID ?? ""
        );

        if (!id) continue;

        if (seen.has(id)) {
          continue;
        }

        seen.add(id);

        combined.push({
          ...t,
          _fetchedFrom: tag
        });
      }
    } catch (err) {
      acpDebug(
        `message-request folder ${tag} failed`,
        {
          message: err?.message
        }
      );
    }
  }

  return combined;
}

u(fetchAllPendingRequests, "fetchAllPendingRequests");

/* ============================================================
 * طلبات الصداقة
 * ============================================================
 */

async function fetchFriendRequests(api) {
  const QUERY_VARIANTS = [
    {
      doc_id: "4499164963466303",
      variables: JSON.stringify({
        input: {
          scale: 3
        }
      })
    },

    {
      doc_id: "7090570720997813",
      variables: JSON.stringify({
        count: 30,
        scale: 1
      })
    },

    {
      doc_id: "3948416105228884",
      variables: JSON.stringify({
        count: 20,
        scale: 1
      })
    }
  ];

  let lastError = null;

  for (const {
    doc_id,
    variables
  } of QUERY_VARIANTS) {
    try {
      const form = {
        av: api.getCurrentUserID(),

        fb_api_caller_class:
          "RelayModern",

        fb_api_req_friendly_name:
          "FriendingCometFriendRequestsRootQueryRelayPreloader",

        variables,

        server_timestamps: "true",

        doc_id
      };

      let raw;

      if (
        typeof api.httpPost ===
        "function"
      ) {
        raw = await api.httpPost(
          "https://www.facebook.com/api/graphql/",
          form
        );
      } else if (
        api._defaultFuncs?.post
      ) {
        raw = await api._defaultFuncs.post(
          "https://www.facebook.com/api/graphql/",
          getAuthContext(api)?.jar,
          form
        );
      } else {
        throw new Error(
          "httpPost unavailable"
        );
      }

      const json =
        parseFacebookResponse(raw);

      const errors =
        json?.errors ||
        json?.__records?.flatMap(
          r => r?.errors || []
        ) ||
        [];

      if (errors.length) {
        const e = new Error(
          String(
            errors[0]?.message ||
            "Facebook GraphQL error"
          )
        );

        e.code = errors[0]?.code;

        acpDebug(
          `friend request doc_id ${doc_id} rejected`,
          {
            code: e.code,
            message: e.message
          }
        );

        lastError = e;

        continue;
      }

      const edges =
        json?.data?.viewer
          ?.friending_possibilities
          ?.edges ||

        json?.data?.viewer
          ?.friend_requests_v2
          ?.edges ||

        json?.data?.viewer
          ?.friend_requests
          ?.edges ||

        [];

      const candidates =
        edges.length
          ? edges.map(
              e => e?.node ?? e
            )
          : collectFriendNodes(json);

      const unique = new Map();

      for (const node of candidates) {
        const userID = String(
          node?.id ??
          node?.userID ??
          node?.user_id ??
          node?.uid ??
          ""
        );

        if (!userID) continue;

        if (unique.has(userID)) {
          continue;
        }

        unique.set(userID, {
          userID,

          name:
            node?.name ??
            node?.full_name ??
            node?.profile_picture?.label ??
            "مجهول",

          mutualCount:
            node?.mutual_friends?.count ??
            node?.mutualFriendCount ??
            0,

          profileUrl:
            node?.url ??
            null
        });
      }

      acpDebug(
        "friend-request query OK",
        {
          doc_id,
          edges: edges.length,
          found: unique.size
        }
      );

      return [
        ...unique.values()
      ];
    } catch (err) {
      acpDebug(
        `friend-request doc_id ${doc_id} failed`,
        {
          message: err?.message
        }
      );

      lastError = err;
    }
  }

  throw (
    lastError ||
    new Error(
      "تعذر جلب طلبات الصداقة — جميع doc_ids فشلت"
    )
  );
}

u(fetchFriendRequests, "fetchFriendRequests");

/* ============================================================
 * قبول طلب صداقة
 * ============================================================
 */

async function acceptFriendRequest(
  api,
  userID
) {
  const ctx =
    getAuthContext(api);

  /*
   * الطريقة الأولى:
   * acpUserFactory الموجودة أصلًا في المشروع.
   */

  if (
    typeof api._defaultFuncs?.post ===
      "function" &&
    ctx?.userID
  ) {
    try {
      const acpUser =
        acpUserFactory(
          api._defaultFuncs,
          api,
          ctx
        );

      return await acpUser(
        String(userID)
      );
    } catch (err) {
      acpDebug(
        "acpUser accept failed",
        {
          userID,
          message: err?.message
        }
      );
    }
  }

  /*
   * الطريقة الثانية:
   * GraphQL mutation.
   */

  if (
    ctx?.fb_dtsg &&
    ctx?.userID
  ) {
    try {
      const form = {
        av: ctx.userID,

        __user: ctx.userID,

        __a: "1",

        fb_dtsg: ctx.fb_dtsg,

        jazoest:
          ctx.ttstamp || "",

        lsd:
          ctx.lsd ||
          ctx.lsdToken ||
          ctx.fb_dtsg,

        fb_api_caller_class:
          "RelayModern",

        fb_api_req_friendly_name:
          "FriendingCometFriendRequestConfirmMutation",

        variables: JSON.stringify({
          input: {
            source:
              "friends_tab",

            friend_requester_id:
              String(userID),

            actor_id:
              ctx.userID,

            client_mutation_id:
              String(
                Math.floor(
                  Math.random() *
                    1e9
                )
              )
          }
        }),

        server_timestamps:
          "true",

        doc_id:
          "6003738476371496"
      };

      const raw =
        await new Promise(
          (resolve, reject) => {
            api.httpPost(
              "https://www.facebook.com/api/graphql/",
              form,
              (err, res) => {
                if (err) {
                  return reject(err);
                }

                resolve(res);
              }
            );
          }
        );

      const json =
        parseFacebookResponse(raw);

      if (
        json?.errors?.length
      ) {
        throw new Error(
          JSON.stringify(
            json.errors[0]
          )
        );
      }

      return {
        ok: true
      };
    } catch (err) {
      acpDebug(
        "GraphQL friend accept failed",
        {
          userID,
          message: err?.message
        }
      );
    }
  }

  /*
   * الطريقة الثالثة:
   * FCA التقليدية.
   */

  if (
    typeof api.handleFriendRequest !==
    "function"
  ) {
    throw new Error(
      "handleFriendRequest غير متوفر في FCA"
    );
  }

  return new Promise(
    (resolve, reject) => {
      api.handleFriendRequest(
        userID,
        true,
        err => {
          if (err) {
            return reject(err);
          }

          resolve({
            ok: true
          });
        }
      );
    }
  );
}

u(
  acceptFriendRequest,
  "acceptFriendRequest"
);

/* ============================================================
 * رفض طلب صداقة
 * ============================================================
 */

async function rejectFriendRequest(
  api,
  userID
) {
  if (
    typeof api.handleFriendRequest !==
    "function"
  ) {
    throw new Error(
      "handleFriendRequest غير متوفر في FCA"
    );
  }

  return new Promise(
    (resolve, reject) => {
      api.handleFriendRequest(
        userID,
        false,
        err => {
          if (err) {
            return reject(err);
          }

          resolve({
            ok: true
          });
        }
      );
    }
  );
}

u(
  rejectFriendRequest,
  "rejectFriendRequest"
);

/* ============================================================
 * قبول / رفض طلب مراسلة
 * ============================================================
 */

async function handleMessageRequest(
  api,
  threadID,
  accept
) {
  if (
    typeof api.handleMessageRequest !==
    "function"
  ) {
    throw new Error(
      "handleMessageRequest غير متوفر في FCA"
    );
  }

  return new Promise(
    (resolve, reject) => {
      try {
        const result =
          api.handleMessageRequest(
            String(threadID),
            Boolean(accept),
            (err, data) => {
              if (err) {
                return reject(err);
              }

              resolve(
                data ?? {
                  ok: true
                }
              );
            }
          );

        /*
         * بعض نسخ FCA قد تعيد Promise
         * بدل callback.
         */

        if (
          result &&
          typeof result.then ===
            "function"
        ) {
          result
            .then(resolve)
            .catch(reject);
        }
      } catch (err) {
        reject(err);
      }
    }
  );
}

u(
  handleMessageRequest,
  "handleMessageRequest"
);

/* ============================================================
 * إزالة listeners الخاصة برسالة معينة
 * ============================================================
 */

function cleanupInteractiveMessage(
  messageID
) {
  if (
    global.client?.reactionListener
  ) {
    delete global.client
      .reactionListener[
        messageID
      ];
  }

  if (
    global.Kagenou?.replies
  ) {
    delete global.Kagenou
      .replies[
        messageID
      ];
  }
}

u(
  cleanupInteractiveMessage,
  "cleanupInteractiveMessage"
);

/* ============================================================
 * إرسال نتيجة العملية
 * ============================================================
 */

async function sendActionResult(
  api,
  senderID,
  text,
  replyTo
) {
  const safeApi =
    typeof global.wrapApiForSafety ===
    "function"
      ? global.wrapApiForSafety(api)
      : api;

  try {
    await new Promise(
      (resolve, reject) => {
        global.safeSend(
          safeApi,
          text,
          senderID,
          err => {
            if (err) {
              return reject(err);
            }

            resolve();
          },
          replyTo
        );
      }
    );
  } catch (err) {
    acpDebug(
      "failed to send action result",
      {
        message: err?.message
      }
    );
  }
}

u(
  sendActionResult,
  "sendActionResult"
);

/* ============================================================
 * Plugin
 * ============================================================
 */

export default {
  config: {
    name: "acp",

    aliases: [
      "طلبات"
    ],

    version: "3.0.0",

    role: 2,

    countDown: 10,

    category:
      "أدوات المطور",

    description:
      "جلب وإدارة طلبات المراسلة والصداقة المعلقة",

    hidden: true,

    usage: [
      "{pn}acp — عرض جميع الطلبات",

      "{pn}acp قبول <threadID> — قبول طلب مراسلة",

      "{pn}acp رفض <threadID> — رفض طلب مراسلة",

      "{pn}acp صديق قبول <userID> — قبول طلب صداقة",

      "{pn}acp صديق رفض <userID> — رفض طلب صداقة"
    ]
  },

  onStart: u(
    async ({
      api,
      event,
      args,
      message
    }) => {
      const {
        threadID,
        messageID,
        senderID
      } = event;

      if (
        !global._acpLocks
      ) {
        global._acpLocks =
          new Set();
      }

      if (
        global._acpLocks.has(
          senderID
        )
      ) {
        return message.reply(
          "⏳ جاري معالجة طلب سابق، انتظر قليلاً..."
        );
      }

      global._acpLocks.add(
        senderID
      );

      const lockTimer =
        setTimeout(
          () => {
            global._acpLocks?.delete(
              senderID
            );
          },
          5 * 60 * 1000
        );

      try {
        const sub = String(
          args[0] || ""
        )
          .trim()
          .toLowerCase();

        /* ======================================================
         * قبول / رفض طلب مراسلة مباشر
         * ======================================================
         */

        if (
          sub === "قبول" ||
          sub === "accept"
        ) {
          const gid =
            String(
              args[1] || ""
            ).trim();

          if (!gid) {
            return message.reply(
              "❌ حدد threadID:\nacp قبول <threadID>"
            );
          }

          try {
            await handleMessageRequest(
              api,
              gid,
              true
            );

            return message.reply(
              `✅ تم قبول طلب المراسلة\n🆔 ${gid}`
            );
          } catch (e) {
            return message.reply(
              `❌ فشل قبول طلب المراسلة:\n${safeStringify(e)}`
            );
          }
        }

        if (
          sub === "رفض" ||
          sub === "reject"
        ) {
          const gid =
            String(
              args[1] || ""
            ).trim();

          if (!gid) {
            return message.reply(
              "❌ حدد threadID:\nacp رفض <threadID>"
            );
          }

          try {
            await handleMessageRequest(
              api,
              gid,
              false
            );

            return message.reply(
              `🚫 تم رفض طلب المراسلة\n🆔 ${gid}`
            );
          } catch (e) {
            return message.reply(
              `❌ فشل رفض طلب المراسلة:\n${safeStringify(e)}`
            );
          }
        }

        /* ======================================================
         * طلبات الصداقة
         * ======================================================
         */

        if (
          sub === "صديق" ||
          sub === "friend"
        ) {
          const action =
            String(
              args[1] || ""
            )
              .trim()
              .toLowerCase();

          const uid =
            String(
              args[2] || ""
            ).trim();

          if (!uid) {
            return message.reply(
              "❌ حدد UID:\nacp صديق قبول/رفض <userID>"
            );
          }

          if (
            action === "قبول" ||
            action === "accept"
          ) {
            try {
              await acceptFriendRequest(
                api,
                uid
              );

              return message.reply(
                `✅ تم قبول طلب الصداقة\n🆔 UID: ${uid}`
              );
            } catch (e) {
              return message.reply(
                `❌ فشل قبول طلب الصداقة:\n${safeStringify(e)}`
              );
            }
          }

          if (
            action === "رفض" ||
            action === "reject"
          ) {
            try {
              await rejectFriendRequest(
                api,
                uid
              );

              return message.reply(
                `🚫 تم رفض طلب الصداقة\n🆔 UID: ${uid}`
              );
            } catch (e) {
              return message.reply(
                `❌ فشل رفض طلب الصداقة:\n${safeStringify(e)}`
              );
            }
          }

          return message.reply(
            "❌ الأمر غير معروف.\n\n" +
            "استخدم:\n" +
            "acp صديق قبول <userID>\n" +
            "acp صديق رفض <userID>"
          );
        }
