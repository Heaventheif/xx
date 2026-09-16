/**
 * acp.js — إدارة طلبات المراسلة والصداقة + قائمة الأصدقاء
 * v5.0.0 — دمج: acp + friendreq + friend
 *
 * ┌─────────────────────────────────────────────────┐
 * │  طلبات المراسلة                                 │
 * │    acp                  عرض الطلبات             │
 * │    acp قبول <GID>       قبول طلب مراسلة         │
 * │    acp رفض  <GID>       رفض طلب مراسلة          │
 * ├─────────────────────────────────────────────────┤
 * │  طلبات الصداقة                                  │
 * │    acp صديق             عرض الطلبات             │
 * │    acp صديق قبول كل     قبول الكل               │
 * │    acp صديق رفض  كل     رفض الكل                │
 * │    acp صديق قبول <رقم|UID>                       │
 * │    acp صديق رفض  <رقم|UID>                       │
 * ├─────────────────────────────────────────────────┤
 * │  قائمة الأصدقاء                                 │
 * │    acp أصدقاء           قائمة أصدقاء البوت      │
 * │    acp أصدقاء حذف <UID> حذف صديق                │
 * └─────────────────────────────────────────────────┘
 */

// ─── مساعدات مشتركة ──────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function safe(v) {
  if (v instanceof Error) return v.message;
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

/** تحديث رسالة loading بدون throw */
async function edit(api, text, msgID) {
  try { await api.editMessage(text, msgID); }
  catch (_) { /* editMessage غير متوفرة — تجاهل */ }
}

// ─── جلب البيانات ─────────────────────────────────────────────────

/** طلبات المراسلة المعلقة من جميع المجلدات */
async function fetchPendingThreads(api) {
  const seen = new Set(), results = [];
  for (const tag of ['PENDING', 'OTHER', 'SPAM', 'UNKNOWN']) {
    try {
      const list = await api.getThreadList(50, null, [tag]);
      if (!Array.isArray(list)) continue;
      for (const t of list) {
        const id = String(t?.threadID || '');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        results.push({ ...t, _folder: tag });
      }
    } catch (_) {}
  }
  return results;
}

/** طلبات الصداقة المعلقة عبر GraphQL (يجرّب عدة doc_ids) */
async function fetchFriendRequests(api) {
  const DOCS = [
    { doc_id: '4499164963466303', variables: JSON.stringify({ input: { scale: 3 } }) },
    { doc_id: '7090570720997813', variables: JSON.stringify({ count: 50, scale: 1 }) },
    { doc_id: '3948416105228884', variables: JSON.stringify({ count: 50, scale: 1 }) },
  ];
  for (const { doc_id, variables } of DOCS) {
    try {
      const form = {
        av: api.getCurrentUserID(),
        fb_api_caller_class: 'RelayModern',
        fb_api_req_friendly_name: 'FriendingCometFriendRequestsRootQueryRelayPreloader',
        variables, server_timestamps: 'true', doc_id,
      };
      let raw;
      if (typeof api.httpPost === 'function') {
        raw = await api.httpPost('https://www.facebook.com/api/graphql/', form);
      } else if (api._defaultFuncs?.post) {
        const ctx = api._ctx || api.ctx || null;
        raw = await api._defaultFuncs.post('https://www.facebook.com/api/graphql/', ctx?.jar, form);
      } else throw new Error('httpPost unavailable');

      const text = typeof raw === 'string' ? raw.replace(/^for \(;;\);/, '').trim() : null;
      const json = text ? JSON.parse(text) : raw;
      if (json?.errors?.length) continue;

      const edges =
        json?.data?.viewer?.friending_possibilities?.edges ||
        json?.data?.viewer?.friend_requests_v2?.edges ||
        json?.data?.viewer?.friend_requests?.edges || [];

      const unique = new Map();
      for (const edge of edges) {
        const node = edge?.node ?? edge;
        const uid  = String(node?.id || node?.userID || '');
        if (!uid || unique.has(uid)) continue;
        unique.set(uid, {
          userID: uid,
          name: node?.name || node?.full_name || 'مجهول',
          mutualCount: node?.mutual_friends?.count ?? 0,
        });
      }
      return [...unique.values()];
    } catch (_) {}
  }
  throw new Error('تعذر جلب طلبات الصداقة — تحقق من الجلسة.');
}

/** قائمة أصدقاء البوت */
async function fetchFriendsList(api) {
  if (typeof api.getFriendsList === 'function') {
    return api.getFriendsList();
  }
  throw new Error('getFriendsList غير متوفرة في هذا الإصدار.');
}

// ─── تنفيذ قبول / رفض صداقة ──────────────────────────────────────

async function acceptOne(api, uid) {
  const myID = api.getCurrentUserID();
  const form = {
    av: myID, __user: myID, __a: '1',
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: 'FriendingCometFriendRequestConfirmMutation',
    variables: JSON.stringify({
      input: {
        source: 'friends_tab',
        friend_requester_id: String(uid),
        actor_id: myID,
        client_mutation_id: String(Math.floor(Math.random() * 1e9)),
      },
    }),
    server_timestamps: 'true',
    doc_id: '6003738476371496',
  };
  if (typeof api.httpPost === 'function') {
    const raw  = await api.httpPost('https://www.facebook.com/api/graphql/', form);
    const text = typeof raw === 'string' ? raw.replace(/^for \(;;\);/, '').trim() : null;
    const json = text ? JSON.parse(text) : raw;
    if (!json?.errors?.length) return;
    throw new Error(JSON.stringify(json.errors[0]));
  }
  if (typeof api.handleFriendRequest === 'function') {
    return api.handleFriendRequest(uid, true);
  }
  throw new Error('لا توجد طريقة متاحة لقبول الطلب.');
}

async function declineOne(api, uid) {
  const myID = api.getCurrentUserID();
  const form = {
    av: myID, __user: myID, __a: '1',
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: 'FriendingCometFriendRequestDeleteMutation',
    variables: JSON.stringify({
      input: {
        friend_requester_id: String(uid),
        actor_id: myID,
        client_mutation_id: String(Math.floor(Math.random() * 1e9)),
      },
    }),
    server_timestamps: 'true',
    doc_id: '5574260925973988',
  };
  if (typeof api.httpPost === 'function') {
    const raw  = await api.httpPost('https://www.facebook.com/api/graphql/', form);
    const text = typeof raw === 'string' ? raw.replace(/^for \(;;\);/, '').trim() : null;
    const json = text ? JSON.parse(text) : raw;
    if (!json?.errors?.length) return;
    throw new Error(JSON.stringify(json.errors[0]));
  }
  if (typeof api.handleFriendRequest === 'function') {
    return api.handleFriendRequest(uid, false);
  }
  throw new Error('لا توجد طريقة متاحة لرفض الطلب.');
}

/** قبول/رفض الكل مع تقدم */
async function bulkAction(api, reqs, accept, loadingID, apiFn) {
  await edit(api, `⏳ جاري ${accept ? 'قبول' : 'رفض'} ${reqs.length} طلب...`, loadingID);
  let done = 0, fail = 0;
  for (const req of reqs) {
    try { await apiFn(api, req.userID); done++; }
    catch (_) { fail++; }
    await sleep(800);
  }
  return `${accept ? '✅ اكتمل القبول' : '🚫 اكتمل الرفض'}!\n✔️ نجح: ${done}  ❌ فشل: ${fail}\nالمجموع: ${reqs.length}`;
}

// ─── الأمر الرئيسي ─────────────────────────────────────────────────

export default {
  config: {
    name: 'acp',
    aliases: ['طلب', 'صدق'],
    version: '5.0.0',
    role: 2,
    countDown: 10,
    category: 'أدوات المطور',
    description: 'إدارة طلبات المراسلة والصداقة + قائمة الأصدقاء',
    hidden: true,
    usage: [
      '{pn}acp — طلبات المراسلة',
      '{pn}acp قبول/رفض <GID>',
      '{pn}acp صديق — طلبات الصداقة',
      '{pn}acp صديق قبول/رفض كل',
      '{pn}acp صديق قبول/رفض <رقم|UID>',
      '{pn}acp أصدقاء — قائمة الأصدقاء',
      '{pn}acp أصدقاء حذف <UID>',
    ],
  },

  onStart: async ({ api, event, args, message }) => {
    const { senderID } = event;

    // ── حماية من التزامن ────────────────────────────────────────
    if (!global._acpLocks) global._acpLocks = new Set();
    if (global._acpLocks.has(senderID))
      return message.reply('⏳ جاري معالجة طلب سابق، انتظر قليلاً...');
    global._acpLocks.add(senderID);
    const unlock = () => global._acpLocks?.delete(senderID);
    setTimeout(unlock, 5 * 60 * 1000);

    try {
      const a0 = (args[0] || '').trim().toLowerCase(); // sub
      const a1 = (args[1] || '').trim().toLowerCase(); // action / sub2
      const a2 = (args[2] || '').trim().toLowerCase(); // uid / كل

      // ══════════════════════════════════════════════════════════
      // قبول / رفض طلب مراسلة
      // ══════════════════════════════════════════════════════════
      if (a0 === 'قبول' || a0 === 'accept') {
        const gid = args[1]?.trim();
        if (!gid) return message.reply('❌ حدد threadID:\nacp قبول <threadID>');
        try {
          await api.handleMessageRequest(gid, true);
          return message.reply(`✅ تم قبول طلب المراسلة\n🆔 ${gid}`);
        } catch (e) { return message.reply(`❌ فشل قبول طلب المراسلة:\n${safe(e)}`); }
      }

      if (a0 === 'رفض' || a0 === 'reject') {
        const gid = args[1]?.trim();
        if (!gid) return message.reply('❌ حدد threadID:\nacp رفض <threadID>');
        try {
          await api.handleMessageRequest(gid, false);
          return message.reply(`🚫 تم رفض طلب المراسلة\n🆔 ${gid}`);
        } catch (e) { return message.reply(`❌ فشل رفض طلب المراسلة:\n${safe(e)}`); }
      }

      // ══════════════════════════════════════════════════════════
      // قائمة الأصدقاء: acp أصدقاء
      // ══════════════════════════════════════════════════════════
      if (a0 === 'أصدقاء' || a0 === 'friends' || a0 === 'اصدقاء') {

        // حذف صديق: acp أصدقاء حذف <UID>
        if ((a1 === 'حذف' || a1 === 'remove') && a2) {
          const uid = args[2]?.trim();
          if (!uid || !/^\d{5,20}$/.test(uid))
            return message.reply('❌ أدخل UID صحيح (5-20 خانة).');
          if (typeof api.unfriend !== 'function')
            return message.reply('❌ api.unfriend غير متوفرة في هذا الإصدار.');
          try {
            await api.unfriend(uid);
            return message.reply(`✅ تم حذف ${uid} من قائمة الأصدقاء.`);
          } catch (e) { return message.reply(`❌ فشل الحذف:\n${safe(e)}`); }
        }

        // عرض القائمة
        const loading = await message.reply('⏳ جاري جلب قائمة الأصدقاء...');
        try {
          const friends = await fetchFriendsList(api);
          if (!friends?.length) {
            return edit(api, 'ℹ️ قائمة الأصدقاء فارغة.', loading.messageID);
          }
          const lines = friends.slice(0, 30).map(
            (f, i) => `${i + 1}. ${f.fullName || f.name || 'مجهول'} — ${f.userID}`
          );
          const text =
            `👥 أصدقاء البوت (${friends.length}):\n` +
            '─'.repeat(28) + '\n' + lines.join('\n') +
            (friends.length > 30 ? `\n... و${friends.length - 30} آخرين` : '') +
            '\n\nللحذف: acp أصدقاء حذف <UID>';
          return edit(api, text, loading.messageID);
        } catch (e) {
          return edit(api, `❌ ${safe(e)}`, loading.messageID);
        }
      }

      // ══════════════════════════════════════════════════════════
      // طلبات الصداقة: acp صديق
      // ══════════════════════════════════════════════════════════
      if (a0 === 'صديق' || a0 === 'friend') {
        const loading = await message.reply('⏳ جاري جلب طلبات الصداقة...');
        let reqs = [];
        try {
          reqs = await fetchFriendRequests(api);
        } catch (e) {
          return edit(api, `❌ ${safe(e)}`, loading.messageID);
        }

        // عرض فقط
        if (!a1 || a1 === 'قائمة' || a1 === 'list') {
          if (!reqs.length) return edit(api, 'ℹ️ لا توجد طلبات صداقة معلقة.', loading.messageID);
          const lines = reqs.slice(0, 20).map(
            (r, i) =>
              `${i + 1}. ${r.name}\n   🆔 ${r.userID}` +
              (r.mutualCount ? `  •  ${r.mutualCount} مشترك` : '')
          );
          return edit(api,
            `👥 طلبات الصداقة (${reqs.length}):\n${'─'.repeat(28)}\n${lines.join('\n')}\n\n` +
            `قبول كل: acp صديق قبول كل\nقبول برقم: acp صديق قبول 1`,
            loading.messageID
          );
        }

        const isAccept  = a1 === 'قبول' || a1 === 'accept';
        const isDecline = a1 === 'رفض'  || a1 === 'reject';

        if (!isAccept && !isDecline) {
          return edit(api,
            '❓ استخدم:\nacp صديق قبول/رفض كل\nacp صديق قبول/رفض <رقم|UID>',
            loading.messageID
          );
        }

        // الكل
        if (a2 === 'كل' || a2 === 'all') {
          if (!reqs.length) return edit(api, 'ℹ️ لا توجد طلبات معلقة.', loading.messageID);
          const result = await bulkAction(api, reqs, isAccept, loading.messageID,
            isAccept ? acceptOne : declineOne);
          return edit(api, result, loading.messageID);
        }

        // واحد: index أو UID
        const raw = args[2]?.trim() || '';
        let targetUID = null;

        if (/^\d{1,3}$/.test(raw)) {
          const idx = parseInt(raw, 10) - 1;
          if (idx < 0 || idx >= reqs.length)
            return edit(api, `❌ الرقم ${raw} خارج النطاق (1–${reqs.length}).`, loading.messageID);
          targetUID = reqs[idx].userID;
        } else if (/^\d{5,20}$/.test(raw)) {
          targetUID = raw;
        } else {
          return edit(api,
            '❌ حدد رقم الطلب من القائمة أو UID مباشرة.\nمثال: acp صديق قبول 1',
            loading.messageID
          );
        }

        try {
          if (isAccept) await acceptOne(api, targetUID);
          else          await declineOne(api, targetUID);
          return edit(api,
            `${isAccept ? '✅ تم قبول' : '🚫 تم رفض'} طلب الصداقة\n🆔 UID: ${targetUID}`,
            loading.messageID
          );
        } catch (e) {
          return edit(api, `❌ فشل ${isAccept ? 'القبول' : 'الرفض'}:\n${safe(e)}`, loading.messageID);
        }
      }

      // ══════════════════════════════════════════════════════════
      // بدون sub: طلبات المراسلة
      // ══════════════════════════════════════════════════════════
      const loading = await message.reply('⏳ جاري جلب الطلبات المعلقة...');
      const threads = await fetchPendingThreads(api);

      if (!threads.length)
        return edit(api, 'ℹ️ لا توجد طلبات مراسلة معلقة.', loading.messageID);

      const lines = threads.slice(0, 20).map((t, i) => {
        const name  = t.name || t.threadName || '[بدون اسم]';
        const type  = t.isGroup ? '👥 مجموعة' : '👤 شخص';
        const count = t.participantIDs?.length ?? '?';
        return `${i + 1}. ${type} — ${name}\n   🆔 ${t.threadID}  •  📁 ${t._folder}` +
          (t.isGroup ? `  •  👥 ${count}` : '');
      });

      return edit(api,
        `📥 طلبات المراسلة (${threads.length}):\n${'─'.repeat(30)}\n${lines.join('\n')}\n\n` +
        `قبول: acp قبول <threadID>\nرفض:  acp رفض <threadID>\n` +
        `طلبات الصداقة: acp صديق\nأصدقاء البوت: acp أصدقاء`,
        loading.messageID
      );

    } finally {
      unlock();
    }
  },
};

// ─── Plugin Descriptor ───────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-commands-admin-acp',
  meta: { category: 'command-admin', path: 'src/commands/admin/acp.js' },
  setup(_ctx) {},
};
