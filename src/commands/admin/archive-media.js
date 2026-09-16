/**
 * archive-media.js — توجيه الوسائط تلقائياً إلى مجموعة الأرشيف
 * v1.0.0
 *
 * يعترض كل رسالة تحتوي وسائط (صور، فيديو، صوت، ملفات، ستيكر)
 * ويُعيد إرسالها إلى مجموعة الأرشيف مع بيانات المصدر.
 *
 * الأوامر:
 *   archivemedia on  [GID]  — تفعيل التوجيه لهذه المجموعة (أو GID محدد)
 *   archivemedia off [GID]  — إيقاف التوجيه
 *   archivemedia list       — عرض المجموعات المفعَّلة
 *   archivemedia status     — حالة هذه المجموعة
 */

// ─── الإعدادات ────────────────────────────────────────────────────

const ARCHIVE_GID = '1576399760738628';

/** أنواع الوسائط المدعومة من event.attachments */
const SUPPORTED_TYPES = new Set([
  'photo', 'animated_image', 'video', 'audio',
  'file', 'sticker', 'share',
]);

/** المجموعات المفعَّل فيها التوجيه { threadID → { enabledBy, enabledAt } } */
const _active = new Map();

// ─── مساعدات ─────────────────────────────────────────────────────

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' });
  } catch { return String(ts); }
}

function attachmentLabel(type) {
  const labels = {
    photo: '🖼️ صورة',
    animated_image: '🎭 GIF',
    video: '🎬 فيديو',
    audio: '🎵 صوت',
    file: '📎 ملف',
    sticker: '😊 ستيكر',
    share: '🔗 مشاركة',
  };
  return labels[type] || `📦 ${type}`;
}

/**
 * بناء رسالة الأرشيف لكل attachment
 * @returns {{ body: string, attachment?: object }}
 */
function buildForwardPayload(attachment, meta) {
  const header =
    `📦 أرشيف وسائط\n` +
    `${'─'.repeat(26)}\n` +
    `${attachmentLabel(attachment.type)}\n` +
    `📅 ${formatTime(meta.timestamp)}\n` +
    `👤 المُرسِل: ${meta.senderName || meta.senderID}\n` +
    `🆔 UID: ${meta.senderID}\n` +
    `💬 GID: ${meta.threadID}` +
    (meta.threadName ? `\n📛 المجموعة: ${meta.threadName}` : '');

  // أنواع ترسَل كـ URL
  const url =
    attachment.url ||
    attachment.playbackUrl ||
    attachment.previewUrl ||
    attachment.largePreviewUrl ||
    attachment.src ||
    null;

  if (url) {
    return { body: `${header}\n🔗 ${url}` };
  }

  // sticker / share بدون URL
  if (attachment.type === 'sticker') {
    return {
      body: `${header}\n🆔 Sticker ID: ${attachment.stickerID || '—'}`,
    };
  }

  if (attachment.type === 'share') {
    return {
      body:
        `${header}\n` +
        `📌 ${attachment.title || ''}\n` +
        (attachment.description ? `${attachment.description}\n` : '') +
        (attachment.url ? `🔗 ${attachment.url}` : ''),
    };
  }

  return { body: header };
}

// ─── الأمر ───────────────────────────────────────────────────────

export default {
  config: {
    name: 'archivemedia',
    aliases: ['أرف', 'arv'],
    version: '1.0.0',
    author: 'sunken',
    countDown: 3,
    role: 2,
    category: 'إدارة وإشراف',
    description: 'توجيه وسائط المجموعة تلقائياً إلى مجموعة الأرشيف',
    usage: [
      '{pn}archivemedia on       — تفعيل لهذه المجموعة',
      '{pn}archivemedia on <GID> — تفعيل لمجموعة بمعرّفها',
      '{pn}archivemedia off      — إيقاف لهذه المجموعة',
      '{pn}archivemedia list     — عرض المجموعات المفعَّلة',
      '{pn}archivemedia status   — حالة هذه المجموعة',
    ],
  },

  // ── onChat: يعمل على كل رسالة تحتوي وسائط ──────────────────────
  onChat: async ({ api, event }) => {
    // لا توجيه من/إلى مجموعة الأرشيف نفسها
    if (String(event.threadID) === ARCHIVE_GID) return;

    // هل هذه المجموعة مفعَّلة؟
    if (!_active.has(String(event.threadID))) return;

    const atts = (event.attachments || []).filter(
      (a) => SUPPORTED_TYPES.has(a.type)
    );
    if (!atts.length) return;

    // جلب اسم المجموعة (من cache أو API)
    let threadName = null;
    try {
      const info = await api.getThreadInfo(event.threadID);
      threadName = info?.threadName || info?.name || null;
    } catch (_) {}

    // جلب اسم المُرسِل
    let senderName = null;
    try {
      const uinfo = await api.getUserInfo([event.senderID]);
      senderName = uinfo?.[event.senderID]?.name || null;
    } catch (_) {}

    const meta = {
      senderID: event.senderID,
      senderName,
      threadID: event.threadID,
      threadName,
      timestamp: event.timestamp || Date.now(),
    };

    // إرسال كل وسيط على حدة
    for (const att of atts) {
      try {
        const payload = buildForwardPayload(att, meta);
        await api.sendMessage(payload.body, ARCHIVE_GID);
        // تأخير بسيط بين الوسائط المتعددة
        await new Promise((r) => setTimeout(r, 300));
      } catch (err) {
        console.debug('[archivemedia] forward failed:', err?.message);
      }
    }
  },

  // ── onStart: أوامر الإدارة ───────────────────────────────────────
  onStart: async ({ api, event, args, message }) => {
    const { threadID, senderID } = event;
    const sub = (args[0] || '').trim().toLowerCase();
    const gidArg = (args[1] || '').trim();

    // ── تفعيل ────────────────────────────────────────────────────
    if (sub === 'on' || sub === 'تفعيل') {
      const targetGID = /^\d{5,20}$/.test(gidArg) ? gidArg : String(threadID);

      if (String(targetGID) === ARCHIVE_GID) {
        return message.reply('❌ لا يمكن تفعيل التوجيه على مجموعة الأرشيف نفسها.');
      }

      // تحقق أن البوت موجود في المجموعة المستهدفة
      if (targetGID !== String(threadID)) {
        try {
          const info = await api.getThreadInfo(targetGID);
          if (!info) throw new Error('not found');
        } catch {
          return message.reply(`❌ المجموعة ${targetGID} غير موجودة أو البوت غير عضو فيها.`);
        }
      }

      // تحقق أن البوت موجود في مجموعة الأرشيف
      try {
        const archInfo = await api.getThreadInfo(ARCHIVE_GID);
        if (!archInfo) throw new Error('no access');
      } catch {
        return message.reply(
          `❌ البوت لا يستطيع الوصول إلى مجموعة الأرشيف.\n🆔 ${ARCHIVE_GID}\nتأكد أن البوت عضو فيها.`
        );
      }

      _active.set(targetGID, { enabledBy: senderID, enabledAt: Date.now() });

      return message.reply(
        `✅ تم تفعيل أرشفة الوسائط!\n` +
        `📤 المصدر: ${targetGID === String(threadID) ? 'هذه المجموعة' : targetGID}\n` +
        `📥 الأرشيف: ${ARCHIVE_GID}\n\n` +
        `كل الوسائط (صور، فيديو، صوت، ملفات، GIF) ستُوجَّه تلقائياً.`
      );
    }

    // ── إيقاف ────────────────────────────────────────────────────
    if (sub === 'off' || sub === 'إيقاف') {
      const targetGID = /^\d{5,20}$/.test(gidArg) ? gidArg : String(threadID);

      if (!_active.has(targetGID)) {
        return message.reply(`ℹ️ التوجيه غير مفعَّل أصلاً في هذه المجموعة.`);
      }

      _active.delete(targetGID);
      return message.reply(`🔴 تم إيقاف أرشفة الوسائط في المجموعة ${targetGID}.`);
    }

    // ── قائمة المجموعات المفعَّلة ─────────────────────────────────
    if (sub === 'list' || sub === 'قائمة') {
      if (!_active.size) {
        return message.reply('ℹ️ لا توجد مجموعات مفعَّل فيها التوجيه حالياً.');
      }
      const lines = [..._active.entries()].map(
        ([gid, data], i) =>
          `${i + 1}. 🆔 ${gid}\n   ⏱️ منذ: ${formatTime(data.enabledAt)}`
      );
      return message.reply(
        `📋 مجموعات الأرشفة المفعَّلة (${_active.size}):\n` +
        '─'.repeat(28) + '\n' +
        lines.join('\n') +
        `\n\n📥 الأرشيف: ${ARCHIVE_GID}`
      );
    }

    // ── حالة هذه المجموعة ─────────────────────────────────────────
    if (sub === 'status' || sub === 'حالة' || !sub) {
      const gid = String(threadID);
      const data = _active.get(gid);
      if (!data) {
        return message.reply(
          `🔴 الأرشفة مُوقَفة في هذه المجموعة.\n` +
          `لتفعيل: archivemedia on`
        );
      }
      return message.reply(
        `🟢 الأرشفة مفعَّلة!\n` +
        `🆔 هذه المجموعة: ${gid}\n` +
        `📥 الأرشيف: ${ARCHIVE_GID}\n` +
        `⏱️ مفعَّلة منذ: ${formatTime(data.enabledAt)}\n\n` +
        `لإيقاف: archivemedia off`
      );
    }

    // ── مساعدة ───────────────────────────────────────────────────
    return message.reply(
      `📦 أرشفة الوسائط\n${'─'.repeat(28)}\n` +
      `archivemedia on      — تفعيل لهذه المجموعة\n` +
      `archivemedia on <GID> — تفعيل لمجموعة أخرى\n` +
      `archivemedia off     — إيقاف\n` +
      `archivemedia list    — المجموعات المفعَّلة\n` +
      `archivemedia status  — الحالة الحالية\n\n` +
      `📥 مجموعة الأرشيف: ${ARCHIVE_GID}`
    );
  },
};

// ─── Plugin Descriptor ───────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-commands-admin-archive-media',
  meta: { category: 'command-admin', path: 'src/commands/admin/archive-media.js' },
  setup(_ctx) {},
};
