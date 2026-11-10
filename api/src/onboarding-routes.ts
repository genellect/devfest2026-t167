import express, { type Express } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { readSessionCookie } from './session-routes.js';
import { createSessions } from './sessions.js';
import { randomUUID } from 'node:crypto';
import type { Dependencies } from './dependencies.js';
import { HttpError, parse, wrap, type Handler } from './http.js';

export function registerOnboardingRoutes(app: Express, deps: Dependencies, guards: { authenticate: Handler; member: Handler }) {
  const { authenticate, member } = guards;
  const path = (roomId: string, uid: string) => deps.db.doc(`sessions/${roomId}/members/${uid}`);
  const profilePath = (roomId: string, uid: string, id: string, shared: boolean) => deps.db.doc(shared ? `sessions/${roomId}/voiceProfiles/${uid}-${id}` : `users/${uid}/voiceProfiles/default`);
  app.post('/rooms/:roomId/onboarding', authenticate, member, wrap(async (req, res) => {
    const body = parse(z.object({ mode: z.enum(['personal', 'shared']), names: z.array(z.string().trim().min(1).max(40)).min(1).max(12) }).strict().refine((b) => b.mode === 'shared' || b.names.length === 1), req.body);
    const ref = path(req.params.roomId, req.ctx.uid);
    // 声は議論ごとに登録し直す（前回の登録を使い回さない）。本番の試験で、前回の登録を使い回した人には登録の画面が出ず、
    // 別の日・別の場所・別の端末で登録した声では、この議論の声と照合できなかったため（2026-11-10）
    const reused = await deps.db.runTransaction(async (tx) => {
      const [room, own] = await tx.getAll(ref.parent.parent!, ref);
      if (own.get('role') !== 'participant') throw new HttpError(403, 'participant_only', 'Guestとして参加してください');
      // 開始後は、途中から参加して表示名をまだ決めていない人だけが登録できる（登録済みの人は名前を変えない）
      const lateJoin = room.get('phase') === 'discussing' && !room.get('endedAt') && !(own.get('attendees') as unknown[] | undefined)?.length;
      if (room.get('phase') !== 'collecting' && !lateJoin) throw new HttpError(409, 'already_started', '開始前に登録を完了してください');
      // 途中から参加した人の声は、議論中の話者の推定に加えない（推定の名簿が途中で変わると、それまでの集計が消えるため）
      const voiced = false;
      const attendees = body.names.map((displayName) => ({ id: randomUUID(), displayName, voiceRegistered: voiced }));
      tx.update(ref, { voiceSource: deps.voice?.source ?? null, displayName: body.names[0], deviceMode: body.mode, attendees, ready: voiced, updatedAt: FieldValue.serverTimestamp() });
      return voiced;
    });
    res.json({ ok: true, reused });
  }));
  app.post('/rooms/:roomId/voice/:attendeeId', authenticate, member, express.raw({ type: 'audio/pcm', limit: 400_000 }), wrap(async (req, res) => {
    if (req.query.consent !== '1') throw new HttpError(400, 'consent_required', '音声登録への同意を確認してください');
    const provider = deps.voice;
    if (!provider) throw new HttpError(503, 'voice_unavailable', '音声登録の接続設定を確認してください');
    const ref = path(req.params.roomId, req.ctx.uid), own = await ref.get(), room = await ref.parent.parent!.get();
    if (own.get('role') !== 'participant') throw new HttpError(403, 'participant_only', 'Guestだけが登録できます');
    if (room.get('phase') !== 'collecting') throw new HttpError(409, 'already_started', '開始前に登録してください');
    const attendees = own.get('attendees') as { id: string; displayName: string; voiceRegistered: boolean }[] | undefined;
    if (!attendees?.some((a) => a.id === req.params.attendeeId)) throw new HttpError(404, 'attendee_not_found', '参加者を確認してください');
    const pcm = req.body;
    if (!Buffer.isBuffer(pcm) || pcm.length < 8 * 32000 || pcm.length > 12 * 32000 || pcm.length % 2) throw new HttpError(400, 'invalid_voice_sample', '8〜12秒、1人ずつ読み上げてください');
    let features;
    try { features = await provider.extract(pcm); } catch { throw new HttpError(503, 'voice_unavailable', '音声登録を完了できませんでした。再試行してください'); }
    finally { pcm.fill(0); }
    if (!features.embedding || features.speechMs < 2000) throw new HttpError(400, 'voice_retry', '声を十分に確認できませんでした。静かな場所で読み直してください');
    await createSessions(deps.db, deps.now).validate(req.ctx.token!, readSessionCookie(req));
    await deps.db.runTransaction(async (tx) => {
      const [current, latestRoom, login] = await tx.getAll(ref, ref.parent.parent!, deps.db.doc(`users/${req.ctx.uid}/sessions/${req.ctx.session!.sessionId}`));
      if (login.get('revokedAt')) throw new HttpError(401, 'session_revoked', 'ログインし直してください');
      if (current.get('role') !== 'participant' || latestRoom.get('phase') !== 'collecting') throw new HttpError(409, 'already_started', '参加状態が変わりました');
      const rows = current.get('attendees') as typeof attendees;
      if (!rows?.some((a) => a.id === req.params.attendeeId)) throw new HttpError(409, 'roster_changed', '参加者名簿を確認してください');
      const next = rows.map((a) => a.id === req.params.attendeeId ? { ...a, voiceRegistered: true } : a);
      tx.set(profilePath(req.params.roomId, req.ctx.uid, req.params.attendeeId, current.get('deviceMode') === 'shared'), { embedding: features.embedding, version: provider.version, updatedAt: FieldValue.serverTimestamp() });
      tx.update(ref, { attendees: next, ready: next.every((a) => a.voiceRegistered) });
    });
    res.json({ ok: true, source: provider.source });
  }));
  app.post('/voice-profile/delete', authenticate, wrap(async (req, res) => {
    await deps.db.doc(`users/${req.ctx.uid}/voiceProfiles/default`).delete(); res.json({ ok: true });
  }));
}
