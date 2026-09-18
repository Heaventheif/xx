/**
 * Unit tests for SingleSessionGuard (boot-id aware).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SingleSessionGuard } from '../fca-unofficial/lib/safety/SingleSessionGuard.js';

function tmpLock() {
  const dir = fs.mkdtempSync(path.join(process.cwd(), '.lock-test-'));
  return { dir, lockPath: path.join(dir, '.fca-session.lock') };
}

test('acquire succeeds on empty lock path', () => {
  const { dir, lockPath } = tmpLock();
  const g = new SingleSessionGuard({ lockPath });

  assert.equal(g.acquire(), true);
  assert.ok(fs.existsSync(lockPath));

  g.release();
  assert.ok(!fs.existsSync(lockPath));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('second acquire in same process returns false', () => {
  const { dir, lockPath } = tmpLock();
  const a = new SingleSessionGuard({ lockPath });
  const b = new SingleSessionGuard({ lockPath });

  assert.equal(a.acquire(), true);
  // نفس PID + نفس bootId → يُعتبر حيّاً
  assert.equal(b.acquire(), false);

  a.release();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('stale lock is reclaimed', () => {
  const { dir, lockPath } = tmpLock();

  // اكتب قفل "ميت" — mtime قديم أكثر من staleAfterMs.
  fs.writeFileSync(lockPath, JSON.stringify({
    pid: process.pid,
    ts: Date.now() - 10 * 60 * 1000, // 10 دقائق مضت
    bootId: 'any',
  }));

  const g = new SingleSessionGuard({ lockPath, staleAfterMs: 1000 });
  assert.equal(g.acquire(), true, 'stale lock should be reclaimable');

  g.release();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('foreign bootId with stale mtime is reclaimed', () => {
  const { dir, lockPath } = tmpLock();

  // PID حيّ، لكن bootId مختلف → العملية القديمة من إقلاع سابق.
  fs.writeFileSync(lockPath, JSON.stringify({
    pid: process.pid,
    ts: Date.now(),  // mtime fresh
    bootId: 'a-different-boot-id-entirely',
  }));

  const g = new SingleSessionGuard({ lockPath, staleAfterMs: 60_000 });
  assert.equal(g.acquire(), true, 'different bootId means stale lock');

  g.release();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('release does not remove foreign lock', () => {
  const { dir, lockPath } = tmpLock();

  // اكتب قفل عملية أخرى (PID مختلف).
  const foreignPid = process.pid + 1;
  fs.writeFileSync(lockPath, JSON.stringify({
    pid: foreignPid,
    ts: Date.now(),
    bootId: 'not-our-boot-id',
  }));

  const g = new SingleSessionGuard({ lockPath });
  g.release(); // يجب ألا يحذف القفل لأن pid/bootId لا يطابقان

  assert.ok(fs.existsSync(lockPath), 'foreign lock must survive our release');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('lockPath outside cwd is rejected', () => {
  assert.throws(
    () => new SingleSessionGuard({ lockPath: '/etc/forbidden.lock' }),
    /outside working directory/
  );
});