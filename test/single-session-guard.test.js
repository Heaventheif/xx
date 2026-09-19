/**
 * SingleSessionGuard tests — معطّل (fca-unofficial مُزال)
 * fca-nx لا تتضمن SingleSessionGuard
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('placeholder — fca-nx does not use SingleSessionGuard', () => {
  assert.ok(true, 'session locking not needed with fca-nx');
});
