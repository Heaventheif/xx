"use strict";

// report: prints the error to console only — no email, no external delivery.
function report(context, err) {
  const message = err?.message || String(err);
  console.error(`[ERROR] [${context}]`, message);
}

export { report };
export default { report };
