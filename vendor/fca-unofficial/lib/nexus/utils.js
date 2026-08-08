import stream from "stream";

export function getType(obj) { return Object.prototype.toString.call(obj).slice(8,-1); }
export function isReadableStream(obj) { return obj instanceof stream.Stream && typeof obj._read === "function" && typeof obj._readableState === "object"; }
export function getGUID() { return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,c=>{const r=(Math.random()*16)|0;return(c==="x"?r:(r&0x3)|0x8).toString(16);}); }
export function parseBody(raw) {
  if (!raw) throw new Error("Empty response");
  const s = typeof raw === "string" ? raw : (raw.body ? String(raw.body) : JSON.stringify(raw));
  const clean = s.replace(/^for\s*\([^)]*\);\s*/,"").replace(/^while\s*\(1\);\s*/,"").replace(/^\/\*.*?\*\/\s*/s,"").trim();
  if (!clean) throw new Error("Empty body after stripping");
  return JSON.parse(clean);
}
export function makeCallback(resolve, reject, existing) {
  if (existing) return existing;
  return (err, data) => err ? reject(err) : resolve(data);
}
