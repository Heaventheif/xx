/**
 * SingleSessionGuard.js — حارس الجلسة الفردية.
 *
 * يضمن عدم تشغيل أكثر من عملية FCA واحدة في نفس الوقت باستخدام ملف قفل
 * على القرص. يعتمد على ثلاث طبقات من التحقق لتجنّب السيناريوهات الخطرة:
 *
 *   1. mtime freshness  — هل النبضة حديثة؟ (يمنع القفل الميت المتروك)
 *   2. PID liveness     — هل العملية المالكة لا تزال حيّة؟
 *   3. bootId match     — هل الـ PID ينتمي لنفس إقلاع النظام؟
 *                         (يمنع حالة إعادة استخدام PID داخل حاوية أُعيد تشغيلها)
 *
 * بدون الفحص الثالث، عملية جديدة في حاوية جديدة قد تتلقى نفس الـ PID
 * الذي كان لعملية قديمة، فيبدو القفل "حيّاً" بينما هو في الواقع يتيم.
 */
import fs   from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ─── bootId (module-level, cached per process) ──────────────────────────────
// نستخدم /proc/sys/kernel/random/boot_id على Linux. على macOS/Windows
// نُشكّل معرّفاً من PID + وقت الإقلاع (وقت الإقلاع = الآن − uptime).
let _bootIdCache = null;
function getBootId() {
  if (_bootIdCache) return _bootIdCache;

  try {
    // Linux: ملف ثابت لكل إقلاع، يبقى نفسه عبر كل العمليات.
    _bootIdCache = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  } catch {
    // Fallback: PID + وقت الإقلاع. ليس مثالياً لكنه أفضل من لا شيء.
    // ملاحظة: على macOS/Windows قد يتغيّر هذا عند إعادة تشغيل العملية،
    // لكن مفعول القفل يبقى صحيحاً لأن mtime يتحقق أولاً.
    const bootTime = Math.floor(Date.now() - process.uptime() * 1000);
    _bootIdCache  = crypto.createHash('sha1')
      .update(`${process.pid}-${bootTime}`)
      .digest('hex')
      .slice(0, 16);
  }
  return _bootIdCache;
}

// ─── SingleSessionGuard ─────────────────────────────────────────────────────

export class SingleSessionGuard {
  /**
   * @param {object} [opts]
   * @param {string} [opts.lockPath]        - مسار ملف القفل (افتراضي: .fca-session.lock)
   * @param {number} [opts.staleAfterMs=60000] - مدة اعتبار القفل منتهياً
   */
  constructor(opts = {}) {
    const lockPath = opts.lockPath || path.join(process.cwd(), '.fca-session.lock');
    const resolved = path.resolve(lockPath);
    const cwd      = path.resolve(process.cwd());

    if (!resolved.startsWith(cwd + path.sep) && resolved !== cwd) {
      throw new Error(`SingleSessionGuard: lockPath outside working directory: ${resolved}`);
    }

    this.lockPath     = resolved;
    this.staleAfterMs = opts.staleAfterMs || 60_000;
    this._pid         = process.pid;
    this._bootId      = getBootId();
    this._interval    = null;
    this._stopped     = false;
  }

  // ── واجهة عامة ─────────────────────────────────────────────────────────────

  /**
   * احصل على القفل. تُرجع true عند النجاح، false إذا كانت جلسة أخرى نشطة.
   * @returns {boolean}
   */
  acquire() {
    try {
      // ── قراءة القفل الموجود إن وُجد وتقييمه ─────────────────────────────
      if (fs.existsSync(this.lockPath)) {
        let existing = null;
        try { existing = JSON.parse(fs.readFileSync(this.lockPath, 'utf8')); } catch {}

        if (existing && this._isLive(existing)) {
          return false;
        }

        // القفل ميت — نتخلص منه حتى نتمكّن من إنشاء قفل جديد بـ O_EXCL.
        try { fs.unlinkSync(this.lockPath); } catch {}
      }

      // ── إنشاء ذرّي (O_EXCL) — يمنع عمليتين من الفوز بنفس اللحظة ─────────
      this._writeLock(true);
      this._scheduleHeartbeat();

      // نُسجّل تحريراً عند خروج العملية حتى في الحالات غير الطبيعية.
      process.once('exit', () => this.release());
      return true;
    } catch {
      return false;
    }
  }

  /** أفلت القفل وأوقف النبضات */
  release() {
    this._stopped = true;

    if (this._interval) {
      clearTimeout(this._interval);
      this._interval = null;
    }

    try {
      if (!fs.existsSync(this.lockPath)) return;
      const existing = JSON.parse(fs.readFileSync(this.lockPath, 'utf8'));
      // لا نحذف قفل عملية أخرى أخذت القفل بيننا.
      if (existing.pid === this._pid && existing.bootId === this._bootId) {
        fs.unlinkSync(this.lockPath);
      }
    } catch { /* فشل صامت */ }
  }

  // ── داخلي ───────────────────────────────────────────────────────────────────

  /**
   * هل القفل "حيّ"؟ يشترط تحقّق ثلاث شروط معاً:
   *   - mtime حديث (نبضة خلال staleAfterMs)
   *   - العملية المالكة حيّة
   *   - bootId متطابق (إن كان مسجَّلاً)
   *
   * @param {object} existing  - parsed lock file
   * @returns {boolean}
   */
  _isLive(existing) {
    const mtimeFresh = Date.now() - (existing?.ts || 0) < this.staleAfterMs;
    if (!mtimeFresh) return false;

    const pid = existing?.pid;
    if (!pid) return false;

    let pidAlive = false;
    try {
      process.kill(pid, 0);           // 0 = signal-only probe, لا يقتل
      pidAlive = true;
    } catch (e) {
      // EPERM يعني العملية موجودة لكن بمستخدم مختلف. نعتبرها حيّة لتجنّب
      // التقاط قفل عملية أخرى تعمل تحت uid مختلف.
      pidAlive = e?.code === 'EPERM';
    }
    if (!pidAlive) return false;

    // فحص bootId إذا كان مسجَّلاً. القفل الذي سجّله إصدار قديم (بدون bootId)
    // يمرّ من هذه الطبقة لأسباب توافقية.
    if (existing?.bootId && existing.bootId !== this._bootId) return false;

    return true;
  }

  /** اكتب ملف القفل. عند exclusive=true نستخدم flag 'wx' (O_EXCL). */
  _writeLock(exclusive = false) {
    const flags = exclusive ? 'wx' : 'w';
    const payload = JSON.stringify({
      pid:    this._pid,
      ts:     Date.now(),
      bootId: this._bootId,
    });
    fs.writeFileSync(this.lockPath, payload, {
      encoding: 'utf8',
      mode:     0o600,
      flag:     flags,
    });
  }

  /** حساب فاصل النبضة (ثلث مدة الانتهاء، بحد 1ث إلى 30ث) */
  _heartbeatInterval() {
    return Math.max(1_000, Math.min(30_000, Math.floor(this.staleAfterMs / 3)));
  }

  /** جدوِّل النبضة القادمة مع jitter ±25% لتجنّب نمط كتابة قابل للكشف */
  _scheduleHeartbeat() {
    if (this._stopped) return;

    const base   = this._heartbeatInterval();
    const jitter = (Math.random() * 0.5 - 0.25) * base;
    const delay  = Math.max(500, Math.round(base + jitter));

    this._interval = setTimeout(() => {
      try { this._writeLock(); }
      catch { /* قد تكون العملية قد حرّرت القفل بينما كنا ننتظر */ }
      this._scheduleHeartbeat();
    }, delay);

    this._interval?.unref?.();
  }
}

export default SingleSessionGuard;

// ─── Plugin Descriptor ──────────────────────────────────────────────────────
/** @type {import('./plugin-provider.js').FcaPlugin} */
export const $plugin = {
  name: 'fca-safety-single-session-guard',
  meta: { category: 'safety', path: 'lib/safety/SingleSessionGuard.js' },
  setup(_ctx) {
    // provides: SingleSessionGuard (default)
  },
};