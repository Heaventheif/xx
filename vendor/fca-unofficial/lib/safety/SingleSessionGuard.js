import fs from "fs";
import path from "path";

// SECURITY (CVE-FCA-04, Medium): every other on-disk store in this project
// (jsonStore, device-manager, session-guard, cookie-refresher,
// FacebookSafety's store) was hardened to write with owner-only 0600/0700
// permissions and to reject a caller-supplied path outside the working
// directory. This file was missed in that pass: the lock file was written
// with the default mode (often 0644 — world-readable, depending on umask),
// and a caller-supplied `lockPath` was not validated. The lock file itself
// only holds a pid/timestamp (not a secret), but leaving one store
// inconsistent with the rest invites the same gap to be copy-pasted
// elsewhere, so it's fixed here for consistency with the rest of the
// hardened stores. Note this remains a best-effort, not cryptographic,
// single-instance guard — the existsSync/readFileSync/writeFileSync
// sequence in acquire() has an inherent small TOCTOU race, same as before.
export default class SingleSessionGuard {
  constructor(opts={}) {
    const rawPath = opts.lockPath || path.join(process.cwd(), ".fca-session.lock");
    const resolvedPath = path.resolve(rawPath);
    const allowedBase = path.resolve(process.cwd());
    if (!resolvedPath.startsWith(allowedBase + path.sep) && resolvedPath !== allowedBase) {
      throw new Error(`SingleSessionGuard: lockPath outside working directory is not allowed: ${resolvedPath}`);
    }
    this.lockPath = resolvedPath;
    this.staleAfterMs = opts.staleAfterMs || 60000;
    this._pid = process.pid; this._interval = null;
  }
  _write(data) {
    // SECURITY: restrict to owner-only, matching the other safety stores.
    fs.writeFileSync(this.lockPath, JSON.stringify(data), { encoding: "utf8", mode: 0o600 });
  }
  acquire() {
    try {
      if (fs.existsSync(this.lockPath)) {
        const d = JSON.parse(fs.readFileSync(this.lockPath,"utf8"));
        if (Date.now()-(d.ts||0) < this.staleAfterMs) { try{process.kill(d.pid,0);return false;}catch(_){} }
      }
      this._write({ pid: this._pid, ts: Date.now() });
      this._interval = setInterval(()=>{try{this._write({ pid: this._pid, ts: Date.now() });}catch(_){}},30000);
      process.once("exit",()=>this.release());
      return true;
    } catch(e){return false;}
  }
  release() {
    if(this._interval){clearInterval(this._interval);this._interval=null;}
    try{if(fs.existsSync(this.lockPath)){const d=JSON.parse(fs.readFileSync(this.lockPath,"utf8"));if(d.pid===this._pid)fs.unlinkSync(this.lockPath);}}catch(_){}
  }
}
