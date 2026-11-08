import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { DEFAULT_SESSION_POLICY, idleMs, sessionLimit, schoolOf } from '../../src/session-policy.js';
import { expiryReason, hashSession, isLocked, requireFresh, sessionSecret, type Session } from '../../src/sessions.js';
import { mayReadResult, wireData } from '../../src/live-routes.js';
const token = { auth_time: 1000 } as DecodedIdToken;
const make = (patch: Partial<Session> = {}) => ({ lastActivityAt: Timestamp.fromMillis(0), expiresAt: Timestamp.fromMillis(168 * 3600_000), revokedAt: null, isSharedDevice: false, ...patch }) as Session;
describe('セッションポリシー', () => {
  it('168時間ちょうどで失効し、1分前は有効', () => {
    const max = idleMs(DEFAULT_SESSION_POLICY);
    expect(max).toBe(168 * 3600_000);
    expect(expiryReason(make(), max - 60_000, DEFAULT_SESSION_POLICY)).toBeNull();
    expect(expiryReason(make(), max, DEFAULT_SESSION_POLICY)).toBe('idle_expired');
  });
  it('失効理由を保持し、授業終了を共用端末だけに強制する', () => {
    expect(expiryReason(make({ revokedAt: Timestamp.now(), revokeReason: 'replaced' }), 1, DEFAULT_SESSION_POLICY)).toBe('replaced');
    expect(expiryReason(make({ isSharedDevice: true, classEndsAt: Timestamp.fromMillis(10) }), 10, DEFAULT_SESSION_POLICY)).toBe('class_ended');
    expect(expiryReason(make({ classEndsAt: Timestamp.fromMillis(10) }), 10, DEFAULT_SESSION_POLICY)).toBeNull();
  });
  it('15分ちょうどでロックし、一度ロックしたら操作で解除しない', () => {
    const s = make({ isSharedDevice: true });
    expect(isLocked(s, 15 * 60_000 - 1, DEFAULT_SESSION_POLICY)).toBe(false);
    expect(isLocked(s, 15 * 60_000, DEFAULT_SESSION_POLICY)).toBe(true);
    expect(isLocked(make({ isSharedDevice: true, lockedAt: Timestamp.now() }), 1, DEFAULT_SESSION_POLICY)).toBe(true);
  });
  it('編集機能を持たない共通ルールと学校IDの形式を保持する', () => {
    expect(sessionLimit(DEFAULT_SESSION_POLICY)).toBe(1);
    expect(Object.isFrozen(DEFAULT_SESSION_POLICY)).toBe(true);
    expect(schoolOf({ ...token, schoolId: '../bad' })).toBeNull();
  });
  it('セッションの秘密値の形式と新しい認証時刻を検査する', () => {
    expect(hashSession('secret')).toMatch(/^[a-f0-9]{64}$/);
    expect(() => sessionSecret('bad')).toThrow();
    expect(sessionSecret('a'.repeat(43))).toHaveLength(43);
    expect(() => requireFresh(token, 1000_000)).not.toThrow();
    expect(() => requireFresh(token, 1300_000)).toThrow();
    expect(() => requireFresh(token, 1000_000, 1001_000)).toThrow();
  });
  it('グループ別結果を限定し、時刻を再帰的にシリアライズする', () => {
    expect(mayReadResult('group-1', false, 1, true)).toBe(true);
    expect(mayReadResult('flow-g1', false, 2)).toBe(false);
    expect(mayReadResult('summary', false, 1)).toBe(false);
    expect(mayReadResult('summary', true, 0)).toBe(true);
    expect(mayReadResult('group-1', false, 1)).toBe(false);
    expect(wireData({ at: Timestamp.fromMillis(1), values: [null, 'test'] })).toEqual({ at: { __time: 1 }, values: [null, 'test'] });
  });
});
