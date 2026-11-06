import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { HttpError } from './http.js';
import { DEFAULT_SESSION_POLICY, FRESH_LOGIN_MS, SECURITY_RETENTION_MS, idleMs, schoolOf, sessionLimit, readSessionPolicy, type SessionPolicy } from './session-policy.js';

export const SESSION_REASONS = ['idle_expired', 'replaced', 'logout', 'logout_all', 'admin_revoked', 'class_ended'] as const;
export type RevokeReason = typeof SESSION_REASONS[number];
export interface Session {
  sessionId: string; uid: string; schoolId: string | null;
  deviceLabel: string; deviceType: 'pc' | 'tablet' | 'phone' | 'other'; userAgentSummary: string;
  createdAt: Timestamp; lastActivityAt: Timestamp; expiresAt: Timestamp; deleteAt: Timestamp;
  revokedAt: Timestamp | null; revokeReason: RevokeReason | null; lockedAt: Timestamp | null;
  reauthenticatedAt: Timestamp; isSharedDevice: boolean; classEndsAt: Timestamp | null;
}
export interface SecurityNotification { newSession(input: { uid: string; sessionId: string }): Promise<void> }
export const hashSession = (secret: string) => createHash('sha256').update(secret).digest('hex');
const idPattern = /^[a-f0-9]{64}$/;
export function sessionSecret(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new HttpError(401, 'session_required', 'Googleでログインし直してください');
  return value;
}
export function requireFresh(token: DecodedIdToken, now: number, after = 0) {
  const at = token.auth_time * 1000;
  if (!Number.isFinite(at) || at > now + 30_000 || now - at >= FRESH_LOGIN_MS || at < after)
    throw new HttpError(401, 'reauth_required', 'Googleで本人確認をしてください');
}
export function expiryReason(s: Session, now: number, policy: SessionPolicy): RevokeReason | null {
  if (s.revokedAt) return s.revokeReason ?? 'logout';
  if (now >= Math.min(s.expiresAt.toMillis(), s.lastActivityAt.toMillis() + idleMs(policy))) return 'idle_expired';
  if (s.isSharedDevice && policy.endAtClassEnd && s.classEndsAt && now >= s.classEndsAt.toMillis()) return 'class_ended';
  return null;
}
export function isLocked(s: Session, now: number, policy: SessionPolicy) {
  return s.isSharedDevice && (!!s.lockedAt || now - s.lastActivityAt.toMillis() >= policy.sharedIdleMinutes * 60_000);
}
export function createSessions(db: Firestore, now: () => number, notifications?: SecurityNotification) {
  const ref = (uid: string, id: string) => db.doc(`users/${uid}/sessions/${id}`);
  const control = (uid: string) => db.doc(`users/${uid}/sessionControl/state`);
  const stamp = () => Timestamp.fromMillis(now());
  async function policy(token: DecodedIdToken): Promise<SessionPolicy> {
    const school = schoolOf(token);
    if (!school) return DEFAULT_SESSION_POLICY;
    const snap = await db.doc(`schools/${school}/security/policy`).get();
    return snap.exists ? readSessionPolicy(snap.data()!) : DEFAULT_SESSION_POLICY;
  }
  // 監査データにuid/セッションID/自由入力を含めず、関連付けは非公開のランダムsubjectIdだけ。
  function audit(tx: Transaction, event: string, subjectId: string, reason?: string) {
    tx.create(db.collection('securityEvents').doc(), { event, subjectId, at: stamp(), deleteAt: Timestamp.fromMillis(now() + SECURITY_RETENTION_MS), ...(reason ? { reason } : {}) });
  }
  async function failed(event: 'login_failed' | 'suspicious_auth') {
    await db.collection('securityEvents').add({ event, at: stamp(), deleteAt: Timestamp.fromMillis(now() + SECURITY_RETENTION_MS) });
  }
  function revoke(tx: Transaction, s: Session, reason: RevokeReason, subjectId: string) {
    tx.update(ref(s.uid, s.sessionId), { revokedAt: stamp(), revokeReason: reason, deleteAt: Timestamp.fromMillis(now() + SECURITY_RETENTION_MS) });
    audit(tx, reason === 'idle_expired' ? 'session_expired' : reason === 'replaced' ? 'session_replaced' : reason === 'admin_revoked' ? 'admin_revoked' : 'session_revoked', subjectId, reason);
  }
  async function create(token: DecodedIdToken, info: Pick<Session, 'deviceLabel' | 'deviceType' | 'isSharedDevice'> & { classEndsAt: number | null }, oldSecret?: string) {
    requireFresh(token, now());
    const p = await policy(token), uid = token.uid, secret = randomBytes(32).toString('base64url'), id = hashSession(secret);
    const data: Session = { ...info, classEndsAt: info.classEndsAt === null ? null : Timestamp.fromMillis(info.classEndsAt), uid, sessionId: id, schoolId: schoolOf(token), userAgentSummary: info.deviceType, createdAt: stamp(), lastActivityAt: stamp(), expiresAt: Timestamp.fromMillis(now() + idleMs(p)), deleteAt: Timestamp.fromMillis(now() + idleMs(p) + SECURITY_RETENTION_MS), revokedAt: null, revokeReason: null, lockedAt: null, reauthenticatedAt: stamp() };
    await db.runTransaction(async (tx) => {
      const index = await tx.get(control(uid)), ids = (index.get('activeIds') ?? []) as string[];
      const subjectId = index.get('subjectId') ?? randomUUID();
      const snaps = ids.length ? await tx.getAll(...ids.map((i) => ref(uid, i))) : [];
      const live: Session[] = [];
      for (const snap of snaps) {
        if (!snap.exists) continue;
        const s = snap.data() as Session;
        const reason = expiryReason(s, now(), p);
        if (s.revokedAt) continue;
        if (reason) revoke(tx, s, reason, subjectId);
        else if (oldSecret && s.sessionId === hashSession(oldSecret)) {
          if (s.lockedAt) requireFresh(token, now(), Math.floor(s.lockedAt.toMillis() / 1000) * 1000);
          if (s.isSharedDevice) {
            data.isSharedDevice = true;
            if (s.classEndsAt) data.classEndsAt = Timestamp.fromMillis(Math.min(s.classEndsAt.toMillis(), data.classEndsAt?.toMillis() ?? Infinity));
          }
          revoke(tx, s, 'logout', subjectId);
        }
        else live.push(s);
      }
      live.sort((a, b) => a.lastActivityAt.toMillis() - b.lastActivityAt.toMillis() || a.createdAt.toMillis() - b.createdAt.toMillis() || a.sessionId.localeCompare(b.sessionId));
      while (live.length >= sessionLimit(p)) revoke(tx, live.shift()!, 'replaced', subjectId);
      tx.set(db.doc(`users/${uid}`), { uid, updatedAt: stamp() }, { merge: true });
      tx.create(ref(uid, id), data);
      tx.set(control(uid), { activeIds: [...live.map((s) => s.sessionId), id], subjectId });
      audit(tx, 'login_success', subjectId); audit(tx, 'session_created', subjectId);
    });
    if (p.newDeviceNotifications) {
      // 通知障害は、作成済みセッションを失敗扱いにしない。MVPで配信基盤は追加しない。
      try { await notifications?.newSession({ uid, sessionId: id }); } catch { /* 独立した通知アダプターの責務 */ }
    }
    return { secret, session: data, policy: p };
  }
  async function validate(token: DecodedIdToken, secret: string, options: { allowLocked?: boolean; activity?: boolean } = {}) {
    const id = hashSession(sessionSecret(secret)), p = await policy(token);
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref(token.uid, id));
      if (!snap.exists || snap.get('uid') !== token.uid) return { error: 'session_required' } as const;
      const s = snap.data() as Session, reason = expiryReason(s, now(), p);
      if (reason) {
        if (!s.revokedAt) {
          const index = await tx.get(control(token.uid));
          revoke(tx, s, reason, index.get('subjectId') ?? randomUUID());
          tx.set(control(token.uid), { activeIds: ((index.get('activeIds') ?? []) as string[]).filter((x) => x !== id) }, { merge: true });
        }
        return { error: 'session_revoked', reason } as const;
      }
      if (isLocked(s, now(), p)) {
        if (!s.lockedAt) { s.lockedAt = stamp(); tx.update(snap.ref, { lockedAt: s.lockedAt }); }
        if (!options.allowLocked) return { error: 'session_locked' } as const;
      } else if (options.activity) {
        s.lastActivityAt = stamp(); s.expiresAt = Timestamp.fromMillis(now() + idleMs(p));
        s.deleteAt = Timestamp.fromMillis(s.expiresAt.toMillis() + SECURITY_RETENTION_MS);
        tx.update(snap.ref, { lastActivityAt: s.lastActivityAt, expiresAt: s.expiresAt, deleteAt: s.deleteAt });
      }
      return { session: s, policy: p };
    });
    if ('error' in result) throw new HttpError(result.error === 'session_locked' ? 423 : 401, result.error!, result.error === 'session_locked' ? '学校のセキュリティ設定により、再認証が必要です。' : 'Googleでログインし直してください', { ...('reason' in result ? { reason: result.reason } : {}) });
    return result;
  }
  async function revokeMany(token: DecodedIdToken, id: string | undefined, reason: RevokeReason) {
    if (id !== undefined && !idPattern.test(id)) throw new HttpError(400, 'bad_request', 'セッションを確認してください');
    await db.runTransaction(async (tx) => {
      const index = await tx.get(control(token.uid)), ids = (index.get('activeIds') ?? []) as string[];
      const targets = id ? [id] : ids;
      const snaps = targets.length ? await tx.getAll(...targets.map((i) => ref(token.uid, i))) : [];
      if (id && !snaps[0]?.exists) throw new HttpError(404, 'session_not_found', 'セッションが見つかりません');
      for (const snap of snaps) if (snap.exists && !snap.get('revokedAt')) revoke(tx, snap.data() as Session, reason, index.get('subjectId') ?? randomUUID());
      tx.set(control(token.uid), { activeIds: ids.filter((i) => !targets.includes(i)) }, { merge: true });
      if (!id) audit(tx, reason === 'admin_revoked' ? 'admin_revoked' : 'logout_all', index.get('subjectId') ?? randomUUID(), reason);
    });
  }
  async function list(token: DecodedIdToken) {
    const snaps = await db.collection(`users/${token.uid}/sessions`).orderBy('createdAt', 'desc').limit(30).get();
    return snaps.docs.map((s) => publicSession(s.data() as Session));
  }
  async function setShared(token: DecodedIdToken, secret: string, info: { isSharedDevice: boolean; classEndsAt: number | null }) {
    const checked = await validate(token, secret);
    // 学校で共用として登録したセッションを本人が私物扱いへ変更して保護を外すことはできない。
    if (checked.session.isSharedDevice && !info.isSharedDevice) throw new HttpError(403, 'shared_device_enforced', '共用端末では保護設定を解除できません');
    if (checked.session.classEndsAt && (info.classEndsAt === null || info.classEndsAt > checked.session.classEndsAt.toMillis())) throw new HttpError(403, 'class_end_enforced', '授業終了時刻は延長できません');
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref(token.uid, checked.session.sessionId));
      if (snap.get('revokedAt')) throw new HttpError(401, 'session_revoked', 'Googleでログインし直してください');
      tx.update(snap.ref, { ...info, classEndsAt: info.classEndsAt === null ? null : Timestamp.fromMillis(info.classEndsAt) });
    });
  }
  return { create, validate, revokeMany, list, policy, failed, setShared };
}
export function publicSession(s: Session) {
  return { sessionId: s.sessionId, deviceLabel: s.deviceLabel, deviceType: s.deviceType, createdAt: s.createdAt.toMillis(), lastActivityAt: s.lastActivityAt.toMillis(), expiresAt: s.expiresAt.toMillis(), revokedAt: s.revokedAt?.toMillis() ?? null, revokeReason: s.revokeReason, isSharedDevice: s.isSharedDevice, lockedAt: s.lockedAt?.toMillis() ?? null, classEndsAt: s.classEndsAt?.toMillis() ?? null };
}
