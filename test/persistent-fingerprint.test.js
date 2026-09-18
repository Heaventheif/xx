/**
 * Unit tests for persistent-fingerprint.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  loadPersistentFingerprint,
  savePersistentFingerprint,
  applyPersistentFingerprintToCtx,
} from '../fca-unofficial/lib/safety/persistent-fingerprint.js';

// توجيه الـ store إلى tmpdir لكل اختبار لتفادي التلوّث المتبادل.
function useTmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-test-'));
  process.env.FCA_FINGERPRINT_DIR = dir;
  return dir;
}

test('generate on first call, load on second', () => {
  const dir = useTmpStore();

  const fp1 = loadPersistentFingerprint('999');
  const fp2 = loadPersistentFingerprint('999');

  assert.equal(fp1.userAgent, fp2.userAgent);
  assert.equal(fp1.sessionId, fp2.sessionId);
  assert.equal(fp1.deviceId,  fp2.deviceId);
  assert.equal(fp1.accountUserID, '999');

  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.FCA_FINGERPRINT_DIR;
});

test('different userIDs get different fingerprints', () => {
  const dir = useTmpStore();

  const a = loadPersistentFingerprint('111');
  const b = loadPersistentFingerprint('222');

  assert.notEqual(a.sessionId, b.sessionId);
  assert.notEqual(a.deviceId,  b.deviceId);

  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.FCA_FINGERPRINT_DIR;
});

test('corrupted store is regenerated', () => {
  const dir = useTmpStore();
  const first = loadPersistentFingerprint('333');

  // افسد الملف
  const files = fs.readdirSync(dir);
  assert.equal(files.length, 1);
  fs.writeFileSync(path.join(dir, files[0]), '{not valid json');

  const second = loadPersistentFingerprint('333');
  assert.ok(second.userAgent);
  assert.notEqual(second.sessionId, first.sessionId);

  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.FCA_FINGERPRINT_DIR;
});

test('applyPersistentFingerprintToCtx sets ctx fields', () => {
  const dir = useTmpStore();

  const ctx = { globalOptions: { userAgent: 'old-UA' } };
  const fp = applyPersistentFingerprintToCtx(ctx, '444');

  assert.equal(ctx._fingerprint.userAgent, fp.userAgent);
  assert.equal(ctx._stealthProfile.userAgent, fp.userAgent);
  assert.equal(ctx.globalOptions.userAgent, fp.userAgent);
  assert.equal(ctx._stealthProfile.isFirefox, false);

  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.FCA_FINGERPRINT_DIR;
});

test('savePersistentFingerprint rejects invalid fingerprint shapes gracefully', () => {
  const dir = useTmpStore();
  // Should not throw even if the object is bogus; the load path validates.
  savePersistentFingerprint('555', {});
  const fp = loadPersistentFingerprint('555');
  assert.ok(fp.userAgent);

  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.FCA_FINGERPRINT_DIR;
});