import type { DecodedIdToken } from 'firebase-admin/auth';
/** 学校別の編集機能は提供せず、認証に必要な共通ルールだけを使う。 */
export interface SessionPolicy {
  idleDays: number; maxConcurrentSessions: number; sharedIdleMinutes: number;
  endAtClassEnd: boolean; newDeviceNotifications: boolean;
}
export const DEFAULT_SESSION_POLICY: Readonly<SessionPolicy> = Object.freeze({
  idleDays: 7, maxConcurrentSessions: 1, sharedIdleMinutes: 15, endAtClassEnd: true, newDeviceNotifications: false,
});
export const SECURITY_RETENTION_MS = 30 * 24 * 60 * 60_000;
export const FRESH_LOGIN_MS = 5 * 60_000;
export const SESSION_CHECK_MS = 30_000;
export const schoolOf = (token: DecodedIdToken): string | null => typeof token.schoolId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(token.schoolId) ? token.schoolId : null;
export const sessionLimit = (policy: SessionPolicy) => policy.maxConcurrentSessions;
export const idleMs = (policy: SessionPolicy) => policy.idleDays * 24 * 60 * 60_000;
