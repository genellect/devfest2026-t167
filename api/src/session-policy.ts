import { z } from 'zod';
import type { DecodedIdToken } from 'firebase-admin/auth';
export const sessionPolicySchema = z.object({
  idleDays: z.number().int().min(1).max(7).default(7),
  maxConcurrentSessions: z.number().int().min(1).max(10).default(1),
  sharedIdleMinutes: z.number().int().min(1).max(15).default(15),
  endAtClassEnd: z.boolean().default(true),
  newDeviceNotifications: z.boolean().default(false),
}).strict();
export type SessionPolicy = z.infer<typeof sessionPolicySchema>;
export const DEFAULT_SESSION_POLICY = Object.freeze(sessionPolicySchema.parse({}));
export const SECURITY_RETENTION_MS = 30 * 24 * 60 * 60_000;
export const FRESH_LOGIN_MS = 5 * 60_000;
export const SESSION_CHECK_MS = 30_000;
export const schoolOf = (token: DecodedIdToken): string | null => typeof token.schoolId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(token.schoolId) ? token.schoolId : null;
export const sessionLimit = (policy: SessionPolicy) => policy.maxConcurrentSessions;
export const idleMs = (policy: SessionPolicy) => policy.idleDays * 24 * 60 * 60_000;

/** 旧ポリシーの役割別上限は継承せず、共通上限1台へ移行する。 */
export function readSessionPolicy(value: Record<string, unknown>): SessionPolicy {
  const { studentLimit: _student, teacherLimit: _teacher, adminLimit: _admin, ...current } = value;
  return sessionPolicySchema.parse(current);
}
