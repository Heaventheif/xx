"use strict";

/**
 * Startup environment validator.
 * Logs clear warnings for missing/misconfigured env vars grouped by severity.
 * Call once at startup before any service initialisation.
 */

import chalk from "chalk";

const CHECKS = [
  // ── Critical (bot cannot start without these) ────────────────────────────
  {
    level: "critical",
    key: null,
    label: "FB credentials",
    test: () => {
      const hasAppState = !!(process.env.APPSTATE || process.env.APPSTATE_BOT1);
      const hasEmailPass = !!(process.env.FB_EMAIL && process.env.FB_PASSWORD);
      return hasAppState || hasEmailPass;
    },
    message: "لا يوجد APPSTATE ولا FB_EMAIL/FB_PASSWORD — البوت لن يستطيع الدخول إلى فيسبوك",
  },

  // ── Important (features disabled silently without these) ─────────────────
  {
    level: "warn",
    key: "MONGO_URI",
    label: "MONGO_URI",
    message: "البيانات ستُحفظ في الذاكرة فقط (تُمحى عند الإعادة)",
  },
  {
    level: "warn",
    key: "HF_SPACE_URL",
    label: "HF_SPACE_URL",
    message: "أوامر chess/fb/gemini/groq/manga/novel/pin/song/sub/tts لن تعمل",
  },
  {
    level: "warn",
    key: "INTERNAL_TOKEN",
    label: "INTERNAL_TOKEN",
    message: "طلبات hf-space ستُرفض بـ 401 (INTERNAL_TOKEN غير مضبوط)",
  },

  // ── Optional ──────────────────────────────────────────────────────────────
  {
    level: "info",
    key: "CEREBRAS_API_KEY",
    label: "CEREBRAS_API_KEY",
    message: "أمر gpt (Cerebras) لن يعمل",
  },
  {
    level: "info",
    key: "GROQ_API_KEY",
    label: "GROQ_API_KEY",
    message: "أمر groq ولعبة كلمة500 لن تعملان بشكل كامل",
  },
];

export function checkEnv() {
  let hasCritical = false;
  for (const check of CHECKS) {
    const ok = check.test
      ? check.test()
      : !!(process.env[check.key] || "").trim();

    if (ok) continue;

    if (check.level === "critical") {
      console.error(chalk.red(`[ENV] ❌ CRITICAL — ${check.label}: ${check.message}`));
      hasCritical = true;
    } else if (check.level === "warn") {
      console.warn(chalk.yellow(`[ENV] ⚠️  ${check.label}: ${check.message}`));
    } else {
      console.log(chalk.gray(`[ENV] ℹ️  ${check.label}: ${check.message}`));
    }
  }
  if (hasCritical) {
    console.error(chalk.red("[ENV] تحقق من ملف .env قبل التشغيل"));
  }
}
