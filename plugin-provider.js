/**
 * @file plugin-provider.js
 * @description مزوّد البلاجينات المركزي لمشروع xx-main
 *              يستخدم LAZY_REGISTRY لتجنب تحميل 72 ملف عند الإقلاع.
 *              كل plugin يُحمَّل فقط عند الحاجة (on-demand).
 *
 * @example
 *   import { registerAll, getPlugin, listCategories } from './plugin-provider.js';
 *   await registerAll(pluginSystem);
 *   await registerAll(ps, { categories: ['core', 'db'] });
 *   await registerAll(ps, { exclude: ['xx-src-utils-bot-enhancer'] });
 *
 * @typedef {{
 *   name:        string,
 *   meta?:       { category?: string, path?: string },
 *   middlewares?: Function[],
 *   commands?:    Array<{name:string, handler:Function, options?:object}>,
 *   events?:      Record<string, Function>,
 *   setup?:      (ctx: object) => void | Promise<void>,
 * }} XxPlugin
 */

// ─── LAZY_REGISTRY: لا import مباشر — يُحمَّل كل ملف عند الطلب فقط ──────────
/** @type {Array<[string, () => Promise<{$plugin: XxPlugin}>]>} */
const LAZY_REGISTRY = [
  ['admin',    () => import('./src/commands/admin/acp.js')],
  ['admin',    () => import('./src/commands/admin/adduser.js')],
  ['admin',    () => import('./src/commands/admin/ban.js')],
  ['admin',    () => import('./src/commands/admin/gid.js')],
  ['admin',    () => import('./src/commands/admin/grouplist.js')],
  ['admin',    () => import('./src/commands/admin/kick.js')],
  ['admin',    () => import('./src/commands/admin/stats.js')],
  ['admin',    () => import('./src/commands/admin/uid.js')],
  ['admin',    () => import('./src/commands/admin/unsend.js')],
  ['ai',       () => import('./src/commands/ai/draw.js')],
  ['ai',       () => import('./src/commands/ai/gemini.js')],
  ['ai',       () => import('./src/commands/ai/gptx.js')],
  ['ai',       () => import('./src/commands/ai/groq.js')],
  ['ai',       () => import('./src/commands/ai/imagine.js')],
  ['ai',       () => import('./src/commands/ai/stt.js')],
  ['ai',       () => import('./src/commands/ai/tr.js')],
  ['ai',       () => import('./src/commands/ai/tts.js')],
  ['fun',      () => import('./src/commands/fun/animal.js')],
  ['fun',      () => import('./src/commands/fun/chess.js')],
  ['fun',      () => import('./src/commands/fun/comic.js')],
  ['fun',      () => import('./src/commands/fun/manga.js')],
  ['fun',      () => import('./src/commands/fun/novel.js')],
  ['fun',      () => import('./src/commands/fun/quran.js')],
  ['fun',      () => import('./src/commands/fun/slap.js')],
  ['general',  () => import('./src/commands/general/help.js')],
  ['media',    () => import('./src/commands/media/autodl.js')],
  ['media',    () => import('./src/commands/media/canva.js')],
  ['media',    () => import('./src/commands/media/pin.js')],
  ['media',    () => import('./src/commands/media/random.js')],
  ['media',    () => import('./src/commands/media/song.js')],
  ['media',    () => import('./src/commands/media/sub.js')],
  ['media',    () => import('./src/commands/media/up.js')],
  ['media',    () => import('./src/commands/media/yt.js')],
  ['config',   () => import('./src/config/index.js')],
  ['core',     () => import('./src/core/Client.js')],
  ['core',     () => import('./src/core/Context.js')],
  ['core',     () => import('./src/core/Loader.js')],
  ['core',     () => import('./src/core/Router.js')],
  ['db',       () => import('./src/db/index.js')],
  ['db',       () => import('./src/db/postgres.js')],
  ['db',       () => import('./src/db/schemas.js')],
  ['events',   () => import('./src/events/onMessage.js')],
  ['events',   () => import('./src/events/onReady.js')],
  ['middleware',() => import('./src/middlewares/auth.js')],
  ['middleware',() => import('./src/middlewares/cooldown.js')],
  ['server',   () => import('./src/server/dashboard/facebook-store.js')],
  ['server',   () => import('./src/server/dashboard/index.js')],
  ['server',   () => import('./src/server/dashboard/users.js')],
  ['server',   () => import('./src/server/playground/index.js')],
  ['server',   () => import('./src/server/webServer.js')],
  ['utils',    () => import('./src/utils/banList.js')],
  ['utils',    () => import('./src/utils/bot-enhancer.js')],
  ['utils',    () => import('./src/utils/cache.js')],
  ['utils',    () => import('./src/utils/concurrentDownload.js')],
  ['utils',    () => import('./src/utils/directSend.js')],
  ['utils',    () => import('./src/utils/envCheck.js')],
  ['utils',    () => import('./src/utils/fetchHttp.js')],
  ['utils',    () => import('./src/utils/hfClient.js')],
  ['utils',    () => import('./src/utils/mediaSplitter.js')],
  ['utils',    () => import('./src/utils/mediaStream.js')],
  ['utils',    () => import('./src/utils/pinterestProviders.js')],
  ['utils',    () => import('./src/utils/reactionPicker.js')],
  ['utils',    () => import('./src/utils/roles.js')],
  ['utils',    () => import('./src/utils/safeSend.js')],
  ['utils',    () => import('./src/utils/sharedSession.js')],
  ['utils',    () => import('./src/utils/tempCleanup.js')],
  ['utils',    () => import('./src/utils/timing.js')],
  ['utils',    () => import('./src/utils/translator.js')],
  ['utils',    () => import('./src/utils/urlNormalizer.js')],
  ['utils',    () => import('./src/utils/validate.js')],
  ['utils',    () => import('./src/utils/ytEngine.js')],
  ['utils',    () => import('./src/utils/ytProviders.js')],
];

// ─── كاش للوحدات المُحمَّلة ───────────────────────────────────────────────────
/** @type {Map<number, XxPlugin>} */
const _loaded = new Map();

async function _load(idx) {
  if (_loaded.has(idx)) return _loaded.get(idx);
  const [, loader] = LAZY_REGISTRY[idx];
  const mod = await loader();
  const plugin = mod.$plugin;
  _loaded.set(idx, plugin);
  return plugin;
}

// ─── تحميل الكل ──────────────────────────────────────────────────────────────
async function _loadAll() {
  return Promise.all(LAZY_REGISTRY.map((_, i) => _load(i)));
}

// ─── registerAll ──────────────────────────────────────────────────────────────
/**
 * @param {{ register(p:XxPlugin):Promise<any>, has(name:string):boolean }} pluginSystem
 * @param {{ categories?:string[], names?:string[], exclude?:string[] }} [options]
 */
export async function registerAll(pluginSystem, options = {}) {
  const { categories, names, exclude = [] } = options;

  // تحميل المحدد فقط لتسريع الإقلاع عند تصفية بالفئة
  let indices = LAZY_REGISTRY.map((_, i) => i);
  if (Array.isArray(categories) && categories.length)
    indices = indices.filter(i => categories.includes(LAZY_REGISTRY[i][0]));

  const plugins = await Promise.all(indices.map(i => _load(i)));

  let list = plugins;
  if (Array.isArray(names) && names.length)
    list = list.filter(p => names.includes(p.name));
  if (exclude.length)
    list = list.filter(p => !exclude.includes(p.name));

  for (const plugin of list)
    if (!pluginSystem.has(plugin.name)) await pluginSystem.register(plugin);
}

// ─── registerByCategory ───────────────────────────────────────────────────────
export async function registerByCategory(pluginSystem, category) {
  return registerAll(pluginSystem, { categories: [category] });
}

// ─── getPlugin ────────────────────────────────────────────────────────────────
/** @param {string} name @returns {Promise<XxPlugin|undefined>} */
export async function getPlugin(name) {
  const all = await _loadAll();
  return all.find(p => p.name === name);
}

// ─── listCategories ───────────────────────────────────────────────────────────
export function listCategories() {
  return [...new Set(LAZY_REGISTRY.map(([cat]) => cat))].sort();
}

export default { registerAll, registerByCategory, getPlugin, listCategories };
