import { z } from 'zod';
import type { DecodedIdToken } from 'firebase-admin/auth';
export const sessionPolicySchema = z.object({
  idleDays: z.number().int().min(1).max(7).default(7),
  studentLimit: z.number().int().min(1).max(2).default(1),
  teacherLimit: z.number().int().min(1).max(2).default(2),
  adminLimit: z.number().int().min(1).max(2).default(2),
  sharedIdleMinutes: z.number().int().min(1).max(15).default(15),
  endAtClassEnd: z.boolean().default(true),
  newDeviceNotifications: z.boolean().default(false),
}).strict();
export type SessionPolicy = z.infer<typeof sessionPolicySchema>;
export const DEFAULT_SESSION_POLICY = Object.freeze(sessionPolicySchema.parse({}));
export const SECURITY_RETENTION_MS = 30 * 24 * 60 * 60_000;
export const FRESH_LOGIN_MS = 5 * 60_000;
export const SESSION_CHECK_MS = 30_000;
export type SessionRole = 'student' | 'teacher' | 'admin';
export const roleOf = (token: DecodedIdToken): SessionRole => token.schoolAdmin === true && schoolOf(token) ? 'admin' : token.teacher === true ? 'teacher' : 'student';
export const schoolOf = (token: DecodedIdToken): string | null => typeof token.schoolId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(token.schoolId) ? token.schoolId : null;
export const sessionLimit = (policy: SessionPolicy, role: SessionRole) => policy[`${role}Limit`];
export const idleMs = (policy: SessionPolicy) => policy.idleDays * 24 * 60 * 60_000;
