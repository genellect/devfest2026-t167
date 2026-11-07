import { afterEach, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import { Timestamp } from 'firebase-admin/firestore';
import { cookieName, setSessionCookie } from '../../src/session-routes.js';
import type { Session } from '../../src/sessions.js';

afterEach(() => vi.unstubAllEnvs());
it.each([
  [undefined, undefined, '__Host-discuss_session', true],
  ['remote.example:8080', 'remote.example:9099', '__Host-discuss_session', true],
  ['127.0.0.1:8080', undefined, '__Host-discuss_session', true],
  ['127.0.0.1:8080', 'localhost:9099', 'discuss_session_dev', false],
])('本番とローカルのCookie設定を分離する: %s / %s', (firestore, auth, name, secure) => {
  vi.stubEnv('FIRESTORE_EMULATOR_HOST', firestore);
  vi.stubEnv('FIREBASE_AUTH_EMULATOR_HOST', auth);
  const cookie = vi.fn();
  setSessionCookie({ cookie } as unknown as Response, 'synthetic-cookie', { expiresAt: Timestamp.fromMillis(7000) } as Session, 1000);
  expect(cookieName()).toBe(name);
  expect(cookie).toHaveBeenCalledWith(name, 'synthetic-cookie', {
    httpOnly: true, secure, sameSite: 'strict', path: '/', maxAge: 6000,
  });
  expect(cookie.mock.calls[0][2]).not.toHaveProperty('domain');
});
