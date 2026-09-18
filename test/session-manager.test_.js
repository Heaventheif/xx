/**
 * Unit tests for SessionManager + FileStorage.
 * Run with:  node --test fca-unofficial/test/
 * Or:        bun test fca-unofficial/test/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  SessionManager,
  MemoryStorage,
  FileStorage,
} from '../fca-unofficial/lib/session/session-manager.js';

// ─── Test helpers ────────────────────────────────────────────────────────────

function fakeApi(state, { fingerprint = null, cUser = null } = {}) {
  const s = state.map((c) => ({ ...c }));
  // Inject a c_user cookie matching the value the caller asked for
  if (cUser && !s.some((c) => (c.key || c.name) === 'c_user')) {
    s.push({ key: 'c_user', value: String(cUser) });
  }
  return {
    getAppState: () => s,
    _ctx: fingerprint ? { _fingerprint: fingerprint } : {},
  };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(process.cwd(), '.session-test-'));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test('save + restore roundtrip (MemoryStorage)', async () => {
  const storage = new MemoryStorage();
  const mgr = new SessionManager({ userID: '123', storage });

  await mgr.save(fakeApi([{ key: 'c_user', value: '123' }], { cUser: '123' }), {
    label: 'test',
  });

  const restored = await mgr.restore();
  assert.ok(restored);
  assert.equal(restored.userID, '123');
  assert.equal(restored.appState[0].key, 'c_user');
  assert.equal(restored.version, 1);
  assert.equal(restored.meta.label, 'test');
});

test('save + restore roundtrip (FileStorage, encrypted)', async () => {
  const dir = tmpDir();
  const filePath = path.join(dir, '.session.json');
  const secret = 'unit-test-secret-32-chars-min!!';
  const storage = new FileStorage(filePath, { secret });
  const mgr = new SessionManager({ userID: '999', storage });

  await mgr.save(fakeApi([{ key: 'c_user', value: '999' }], { cUser: '999' }));

  assert.ok(fs.existsSync(filePath), 'file must exist');
  const raw = fs.readFileSync(filePath, 'utf8');
  assert.ok(raw.startsWith('FCASESS1:'), 'file must be encrypted envelope');

  const restored = await mgr.restore();
  assert.equal(restored.userID, '999');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('restore refuses mismatched userID', async () => {
  const storage = new MemoryStorage();
  await new SessionManager({ userID: '111', storage })
    .save(fakeApi([{ key: 'c_user', value: '111' }], { cUser: '111' }));

  const other = new SessionManager({ userID: '222', storage });
  assert.equal(await other.restore(), null);
});

test('save rejects empty appState', async () => {
  const mgr = new SessionManager({ userID: '1', storage: new MemoryStorage() });
  await assert.rejects(
    () => mgr.save(fakeApi([])),
    /appState is empty/
  );
});

test('save rejects missing getAppState', async () => {
  const mgr = new SessionManager({ userID: '1', storage: new MemoryStorage() });
  await assert.rejects(
    () => mgr.save({}, {}),
    /getAppState is not available/
  );
});

test('save rejects appState with mismatched c_user', async () => {
  const mgr = new SessionManager({ userID: '555', storage: new MemoryStorage() });
  await assert.rejects(
    () => mgr.save(fakeApi([{ key: 'c_user', value: '999' }])),
    /belongs to a different user/
  );
});

test('concurrent saves are single-flighted', async () => {
  const storage = new MemoryStorage();
  const mgr = new SessionManager({ userID: '1', storage });
  const api = fakeApi([{ key: 'c_user', value: '1' }], { cUser: '1' });

  const results = await Promise.all([
    mgr.save(api),
    mgr.save(api),
    mgr.save(api),
  ]);

  // All three share the same promise, so identity is preserved.
  assert.equal(results[0], results[1]);
  assert.equal(results[1], results[2]);
});

test('FileStorage refuses paths outside cwd', () => {
  assert.throws(
    () => new FileStorage('/etc/passwd'),
    /outside cwd rejected/
  );
});

test('FileStorage roundtrip preserves fingerprint metadata', async () => {
  const dir = tmpDir();
  const storage = new FileStorage(path.join(dir, '.session.json'), {
    secret: 'unit-test-secret-32-chars-min!!',
  });
  const fp = { sessionId: 'abc123', deviceId: 'def456', userAgent: 'test-UA' };
  const mgr = new SessionManager({ userID: '7', storage });

  await mgr.save(fakeApi([{ key: 'c_user', value: '7' }], { cUser: '7', fingerprint: fp }));
  const restored = await mgr.restore();

  assert.deepEqual(restored.fingerprint, fp);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('FileStorage cannot decrypt with wrong key', async () => {
  const dir = tmpDir();
  const filePath = path.join(dir, '.session.json');

  const writer = new SessionManager({
    userID: '42',
    storage: new FileStorage(filePath, { secret: 'correct-secret-32-chars-min!!!' }),
  });
  await writer.save(fakeApi([{ key: 'c_user', value: '42' }], { cUser: '42' }));

  const reader = new SessionManager({
    userID: '42',
    storage: new FileStorage(filePath, { secret: 'wrong-secret-32-chars-min!!!!!' }),
  });
  assert.equal(await reader.restore(), null, 'wrong key must yield null, not crash');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('clear removes the stored session', async () => {
  const storage = new MemoryStorage();
  const mgr = new SessionManager({ userID: '1', storage });
  await mgr.save(fakeApi([{ key: 'c_user', value: '1' }], { cUser: '1' }));
  assert.equal(await mgr.exists(), true);
  await mgr.clear();
  assert.equal(await mgr.exists(), false);
});