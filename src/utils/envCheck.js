"use strict";
/**
 * Startup environment validator.
 * Logs clear warnings for missing/misconfigured env vars grouped by severity.
 * Call once at startup before any service initialisation.
 *
 * AppState is dashboard-managed only (added via /dashboard's "AppState" tab,
 * saved to appstate*.json) — the bot no longer reads login credentials from
 * environment variables at all, so this no longer checks for APPSTATE* env
 * vars, only for the presence of at least one appstate*.json file.
 */
import chalk from "chalk";
import fs from "fs";
import path from "path";
function hasAnyAppStateFile(projectRoot) {
  if (!projectRoot) return false;
  for (let i = 1; i <= 20; i++) {
    const suffix = i === 1 ? "" : String(i);
    if (fs.existsSync(path.join(projectRoot, `appstate${suffix}.json`))) return true;
  }
  return false;
}
function buildChecks(projectRoot) {
  return [
    {
      level: "warn",
      key: null,
      label: "FB credentials",
      test: () => hasAnyAppStateFile(projectRoot),
      message:
        "لا يوجد أي حساب مضاف بعد — افتح لوحة التحكم (/dashboard) وأضف حساب فيسبوك من تبويب AppState " +
        "(تسجيل الدخول يعتمد على AppState فقط، لا يوجد بديل بالبريد وكلمة المرور، ولا يُقرأ من متغيرات البيئة).",
    },
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
      message: "طلبات hf-space ستُرفض بـ 401، وواجهات /yt/* ستبقى معطّلة (503)",
    },
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
}
export function checkEnv(projectRoot) {
  let hasCritical = false;
  for (const check of buildChecks(projectRoot)) {
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
    console.error(chalk.red("[ENV] تحقق من appstate.json أو أضف حساباً عبر لوحة التحكم (/dashboard) قبل التشغيل"));
  }
}
