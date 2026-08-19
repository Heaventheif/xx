"use strict";

import fs from "fs-extra";


// Messenger practical attachment limit (24MB with 1MB safety margin).
const MAX_PART_BYTES = 24 * 1024 * 1024;

// Returns true if the file size exceeds Messenger's send limit.
function NEEDS_SPLIT(sizeBytes) {
  return sizeBytes > MAX_PART_BYTES;
}

// Always throws FILE_TOO_LARGE — no valid video/audio split available.
// err.code lets callers (fb.js, mediaStream.js) show a user-friendly message.
async function splitFile(filePath, ext = "mp4") {
  const err = new Error(
    `الملف أكبر من الحد الذي يسمح به ماسنجر (~${Math.round(MAX_PART_BYTES / 1024 / 1024)}MB) ` +
    "ولا تتوفر آلية تقسيم فيديو/صوت صالحة حالياً."
  );
  err.code = "FILE_TOO_LARGE";
  throw err;
}

// Delete an array of temp files in parallel, ignoring errors.
async function cleanupParts(partPaths) {
  await Promise.allSettled((partPaths || []).map(p => fs.remove(p)));
}

export { splitFile, cleanupParts, NEEDS_SPLIT, MAX_PART_BYTES };
