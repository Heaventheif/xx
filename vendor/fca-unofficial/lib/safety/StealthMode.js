// SECURITY / DESIGN (CVE-FCA-05, High): the previous defaults were
// maxRequestsPerMinute: 1000 and dailyRequestLimit: 500000 — about 16
// requests *per second* sustained all day. No human account behaves that
// way, and Facebook's own abuse-detection thresholds sit far below that, so
// the old defaults gave a false sense of safety: a bot could run flat-out
// and StealthMode would never once say "slow down." The pauseProbability
// (0.0001) and pause length (6–30s) were too small/rare to matter either.
//
// New defaults model an unusually active human, not a bot: capped request
// bursts, a modest daily ceiling, and pauses frequent/long enough to
// actually look like someone stepping away.
//
// IMPORTANT: this class does not wire itself into the request pipeline —
// it is a utility you must call yourself: `await stealth.waitIfNeeded()`
// before every action you want throttled. Nothing in this library invokes
// it automatically. Even tuned conservatively, StealthMode reduces —
// it does not eliminate — the chance of Facebook flagging the account, and
// tuning it more aggressively than these defaults reintroduces the same
// false sense of security this fix removes.
export default class StealthMode {
  constructor(opts = {}) {
    this.opts = { maxRequestsPerMinute:20, enableRandomPauses:true, pauseProbability:0.02,
      minPauseMinutes:1, maxPauseMinutes:5, dailyRequestLimit:2000, ...opts };
    this.history = []; this.dailyCount = 0; this.lastReset = Date.now();
    this.inPause = false; this.pauseUntil = 0;
  }
  canProceed() {
    const now = Date.now();
    if (this.inPause) { if (now < this.pauseUntil) return { allowed:false, waitMs:this.pauseUntil-now, reason:"Human pause active" }; this.inPause=false; }
    if (now - this.lastReset > 86400000) { this.dailyCount=0; this.lastReset=now; }
    if (this.dailyCount >= this.opts.dailyRequestLimit) return { allowed:false, waitMs:3600000, reason:"Daily limit reached" };
    this.history = this.history.filter(ts => now-ts < 60000);
    if (this.history.length >= this.opts.maxRequestsPerMinute) return { allowed:false, waitMs:60000-(now-this.history[0])+1000, reason:"Rate limit exceeded" };
    return { allowed:true, waitMs:0 };
  }
  recordAction() {
    this.history.push(Date.now()); this.dailyCount++;
    if (this.opts.enableRandomPauses && Math.random() < this.opts.pauseProbability) {
      const dur = Math.floor(Math.random()*(this.opts.maxPauseMinutes-this.opts.minPauseMinutes)*60000)+this.opts.minPauseMinutes*60000;
      this.inPause=true; this.pauseUntil=Date.now()+dur;
    }
  }
  async waitIfNeeded() {
    while (true) { const s=this.canProceed(); if(s.allowed){this.recordAction();return;} await new Promise(r=>setTimeout(r,s.waitMs)); }
  }
}
