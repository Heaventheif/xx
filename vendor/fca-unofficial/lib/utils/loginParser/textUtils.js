export function cleanXssi(t) {
  if (t == null) return "";
  let s = String(t);
  s = s.replace(/^[\uFEFF\xEF\xBB\xBF]+/, "");
  s = s.replace(/^\)\]\}',?\s*/, "");
  s = s.replace(/^\s*for\s*\(;;\);\s*/i, "");
  return s;
}
export function makeParsable(html) {
  const raw = cleanXssi(String(html || ""));
  const split = raw.split(/\}\r?\n\s*\{/);
  if (split.length === 1) return raw;
  return `[${split.join("},{")}]`;
}
export default {
  cleanXssi,
  makeParsable
};