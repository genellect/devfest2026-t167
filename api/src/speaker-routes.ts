import express, { type Express } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import type { DocumentSnapshot, Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';
import type { Dependencies } from './dependencies.js';
import { HttpError, parse, wrap, type AuthRequest, type Handler } from './http.js';
import { createSessions } from './sessions.js';
import { readSessionCookie } from './session-routes.js';
import { matchSpeaker, type VoiceProfile } from './speaker-types.js';

export interface SpeakingState {
  group: number; source: 'mock' | 'model'; version: string; processedMs: number; unknownMs: number;
  talkMs: Record<string, number>; members: { uid: string; label: string }[];
  latest: { uid: string | null; label: string; confidence: number | null } | null; updatedAt: number;
}
const error = (code: string, message: string, status = 409) => new HttpError(status, code, message);
/** 背景の音声送信はactivityに数えない。音声と特徴はレスポンス/DB/ログへ出さない。 */
export function registerSpeakerRoutes(app: Express, deps: Dependencies, guards: { authenticate: Handler; member: Handler }) {
  const { db } = deps, { authenticate, member } = guards;
  let inFlight = 0;
  const root = (req: AuthRequest) => db.doc(`sessions/${req.params.roomId}`);
  async function access(tx: Transaction, req: AuthRequest) {
    const ref = root(req);
    const [room, own, login] = await tx.getAll(ref, ref.collection('members').doc(req.ctx.uid), db.doc(`users/${req.ctx.uid}/sessions/${req.ctx.session!.sessionId}`));
    if (login.get('revokedAt')) throw error('session_revoked', 'ログインし直してください', 401);
    if (own.get('role') !== 'participant' || own.get('status') !== 'active' || !Number.isInteger(own.get('group')) || own.get('group') < 1) throw error('group_required', '所属グループを確認してください', 403);
    if (room.get('flowVersion') !== 1 || room.get('phase') !== 'discussing' || room.get('endedAt') || (room.get('endsAt')?.toMillis() ?? Infinity) <= deps.now()) throw error('not_discussing', 'Hostが開始した議論中だけ利用できます');
    if (room.get('recording') === false) throw error('recording_disabled', '録音は許可されていません');
    const group = own.get('group') as number;
    const configuration = await tx.get(ref.collection('groups').doc(String(group)));
    if (configuration.get('recorderUid') && configuration.get('recorderUid') !== req.ctx.uid) throw error('not_recorder', 'Hostが許可した録音担当端末で実行してください', 403);
    return { ref, group };
  }
  async function profiles(tx: Transaction, req: AuthRequest, group: number) {
    const members = await tx.get(root(req).collection('members').where('group', '==', group));
    const voices: VoiceProfile[] = [];
    for (const m of members.docs.filter((m) => m.get('role') === 'participant' && m.get('status') === 'active')) {
      // 音声登録は任意。登録した人だけを照合し、登録していない人は推定に出さない
      const attendees = (m.get('attendees') as { id: string; displayName: string; voiceRegistered: boolean }[] | undefined) ?? [];
      for (const a of attendees.filter((x) => x.voiceRegistered)) {
        const p = await tx.get(db.doc(m.get('deviceMode') === 'shared' ? `sessions/${req.params.roomId}/voiceProfiles/${m.id}-${a.id}` : `users/${m.id}/voiceProfiles/default`));
        const embedding = p.get('embedding') as number[] | undefined;
        if (p.get('version') !== deps.voice!.version || !embedding?.length || embedding.some((n) => !Number.isFinite(n)) || Math.hypot(...embedding) === 0) continue;
        voices.push({ uid: a.id, label: a.displayName, embedding });
      }
    }
    if (!voices.length) throw error('voice_required', '声を登録した参加者がいないため、発言者の推定は使えません');
    if (voices.length > 40) throw error('roster_invalid', 'グループの参加者を確認してください');
    return voices;
  }
  const fingerprint = (voices: VoiceProfile[]) => createHash('sha256').update(JSON.stringify(voices)).digest('hex');
  function owns(lease: DocumentSnapshot, req: AuthRequest) {
    if (lease.get('id') !== req.params.runId || lease.get('uid') !== req.ctx.uid || lease.get('sessionId') !== req.ctx.session!.sessionId || lease.get('expiresAt') <= deps.now()) throw error('recorder_expired', '録音担当の接続が変わりました。録音を開始し直してください');
  }
  app.get('/rooms/:roomId/speaker/config', authenticate, member, wrap(async (_req, res) => res.json({ enabled: !!deps.voice, source: deps.voice?.source ?? null })));
  app.post('/rooms/:roomId/speaker/start', authenticate, member, wrap(async (req, res) => {
    parse(z.object({ consent: z.literal(true) }).strict(), req.body);
    if (!deps.voice) throw error('voice_unavailable', '話者モデルの接続設定が必要です', 503);
    const result = await db.runTransaction(async (tx) => {
      const { ref, group } = await access(tx, req), voices = await profiles(tx, req, group);
      const leaseRef = ref.collection('speakerLeases').doc(String(group)), lease = await tx.get(leaseRef);
      const stateRef = ref.collection('speaking').doc(String(group)), state = await tx.get(stateRef);
      if (lease.exists && lease.get('expiresAt') > deps.now()) throw error('recorder_exists', 'このグループは別の接続で話者識別中です');
      const hash = fingerprint(voices);
      const id = randomUUID();
      tx.set(leaseRef, { id, uid: req.ctx.uid, sessionId: req.ctx.session!.sessionId, expiresAt: deps.now() + 30_000, sequence: 0, startedAt: deps.now(), bytes: 0, profilesHash: hash });
      // 名簿やモデルが変わった場合は、以前の集計と混ぜない。
      if (!state.exists || lease.get('profilesHash') !== hash || state.get('version') !== deps.voice!.version) tx.set(stateRef, { group, source: deps.voice!.source, version: deps.voice!.version, processedMs: 0, unknownMs: 0, talkMs: Object.fromEntries(voices.map((p) => [p.uid, 0])), members: voices.map(({ uid, label }) => ({ uid, label })), latest: null, updatedAt: deps.now() } satisfies SpeakingState);
      return { runId: id, group, sequence: 0, source: deps.voice!.source };
    });
    res.status(201).json(result);
  }));
  app.post('/rooms/:roomId/speaker/:runId/chunk', authenticate, member, express.raw({ type: 'audio/pcm', limit: 32_000 }), wrap(async (req, res) => {
    const sequence = parse(z.coerce.number().int().min(0).max(1800), req.query.sequence);
    const pcm = req.body;
    if (!Buffer.isBuffer(pcm) || pcm.length !== 32_000) { if (Buffer.isBuffer(pcm)) pcm.fill(0); throw error('invalid_pcm', '16kHz mono PCM16の1秒区間を送信してください', 400); }
    if (!deps.voice) { pcm.fill(0); throw error('voice_unavailable', '話者モデルが利用できません', 503); }
    if (inFlight >= 12) { pcm.fill(0); throw error('speaker_busy', '話者識別の処理が混み合っています', 503); }
    inFlight++;
    try {
      const digest = createHash('sha256').update(pcm).digest('hex');
      const claim = await db.runTransaction(async (tx) => {
        const { ref, group } = await access(tx, req);
        const leaseRef = ref.collection('speakerLeases').doc(String(group)), lease = await tx.get(leaseRef); owns(lease, req);
        if (sequence === lease.get('sequence') - 1 && digest === lease.get('lastDigest')) return { duplicate: true as const, group };
        if (sequence !== lease.get('sequence')) throw error('audio_sequence', '音声の送信順序を確認してください');
        if (lease.get('processingUntil') > deps.now()) throw error('speaker_busy', '音声の処理中です');
        if (lease.get('bytes') >= 30 * 60 * 32_000 || lease.get('bytes') / 32 + 1000 > deps.now() - lease.get('startedAt') + 2000) throw error('audio_rate', '実時間の速度で音声を送信してください');
        const voices = await profiles(tx, req, group);
        if (fingerprint(voices) !== lease.get('profilesHash')) throw error('roster_changed', '声の登録情報が変更されました');
        tx.update(leaseRef, { processingUntil: deps.now() + 20_000 });
        return { duplicate: false as const, group, voices, hash: lease.get('profilesHash') as string };
      });
      if (claim.duplicate) { res.json({ sequence: sequence + 1 }); return; }
      const features = await deps.voice.extract(pcm);
      const match = features.speechMs >= 400 ? matchSpeaker(features.embedding, claim.voices) : { uid: null, confidence: null };
      features.embedding?.fill(0);
      const speechMs = Math.max(0, Math.min(1000, features.speechMs));
      if (!Number.isFinite(speechMs)) throw error('speaker_invalid', '音声を解析できませんでした', 503);
      await createSessions(db, deps.now).validate(req.ctx.token!, readSessionCookie(req));
      await db.runTransaction(async (tx) => {
        const { ref, group } = await access(tx, req);
        const leaseRef = ref.collection('speakerLeases').doc(String(group)), lease = await tx.get(leaseRef); owns(lease, req);
        if (sequence !== lease.get('sequence')) throw error('audio_sequence', '音声の送信順序を確認してください');
        if (fingerprint(await profiles(tx, req, group)) !== claim.hash) throw error('roster_changed', '声の登録情報が変更されました');
        const stateRef = ref.collection('speaking').doc(String(group)), state = (await tx.get(stateRef)).data() as SpeakingState;
        if (match.uid) state.talkMs[match.uid] = (state.talkMs[match.uid] ?? 0) + speechMs;
        else state.unknownMs += speechMs;
        state.processedMs += 1000; state.updatedAt = deps.now();
        state.latest = speechMs ? { ...match, label: claim.voices.find((p) => p.uid === match.uid)?.label ?? '判別不能' } : null;
        tx.set(stateRef, state);
        tx.update(leaseRef, { sequence: sequence + 1, bytes: lease.get('bytes') + pcm.length, lastDigest: digest, processingUntil: 0, expiresAt: deps.now() + 30_000 });
      });
      res.json({ sequence: sequence + 1 });
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw error('speaker_unavailable', '話者識別を停止しました。元の録音は端末に残ります', 503);
    } finally { pcm.fill(0); inFlight--; }
  }));
  app.post('/rooms/:roomId/speaker/:runId/stop', authenticate, member, wrap(async (req, res) => {
    await db.runTransaction(async (tx) => {
      const own = await tx.get(root(req).collection('members').doc(req.ctx.uid));
      if (own.get('role') !== 'participant' || !own.get('group')) throw error('group_required', '所属を確認してください', 403);
      const ref = root(req).collection('speakerLeases').doc(String(own.get('group'))), lease = await tx.get(ref);
      owns(lease, req); tx.update(ref, { expiresAt: 0 });
    });
    res.json({ ok: true });
  }));
}
