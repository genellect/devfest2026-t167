import { acceptSpeech, emptyBucket, type SpeechBucket, type SpeechDelta } from './speech-bucket.js';
import { roomTransaction } from './room-transaction.js';
import express, { type Express } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { Timestamp, type DocumentReference, type DocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import { z } from 'zod';
import type { Dependencies } from './dependencies.js';
import { HttpError, parse, wrap, type AuthRequest, type Handler } from './http.js';
import { createSessions } from './sessions.js';
import { readSessionCookie } from './session-routes.js';
import { matchContextSpeaker, partitionSpeaker, type VoiceProfile } from './speaker-types.js';

export interface SpeakingState {
  group: number; rosterHash?:string; multi?:boolean; source: 'mock' | 'model'; mode?: 'identified' | 'anonymous'; version: string; processedMs: number; unknownMs: number;
  talkMs: Record<string, number>; members: { uid: string; label: string }[];
  latest: { uid: string | null; label: string; confidence: number | null } | null; updatedAt: number;
}
const error = (code: string, message: string, status = 409) => new HttpError(status, code, message);
/** 背景送信はactivityに数えない。匿名話者の特徴は非公開の一時領域だけに置き、配信しない。 */
export function registerSpeakerRoutes(app: Express, deps: Dependencies, guards: { authenticate: Handler; member: Handler }) {
  const { db } = deps, { authenticate, member } = guards;
  let inFlight = 0;
  const root = (req: AuthRequest) => db.doc(`sessions/${req.params.roomId}`);
  async function access(tx: Transaction, req: AuthRequest) {
    const ref = root(req);
    // Keep the session document first across speaker, transcription and analysis transactions.
    const room = await tx.get(ref);
    const [own, login] = await tx.getAll(ref.collection('members').doc(req.ctx.uid), db.doc(`users/${req.ctx.uid}/sessions/${req.ctx.session!.sessionId}`));
    if (login.get('revokedAt')) throw error('session_revoked', 'ログインし直してください', 401);
    if (own.get('role') !== 'participant' || own.get('status') !== 'active' || !Number.isInteger(own.get('group')) || own.get('group') < 1) throw error('group_required', '所属グループを確認してください', 403);
    if (room.get('flowVersion') !== 1 || room.get('phase') !== 'discussing' || room.get('endedAt') || Math.min(room.get('endsAt')?.toMillis() ?? Infinity, room.get('expiresAt')?.toMillis() ?? Infinity) <= deps.now()) throw error('not_discussing', 'Hostが開始した議論中だけ利用できます');
    if (room.get('recording') === false) throw error('recording_disabled', '録音は許可されていません');
    const group = own.get('group') as number;
    const configuration = await tx.get(ref.collection('groups').doc(String(group)));
    const multi = configuration.get('recordingMode') === 'personal';
    if (multi && own.get('deviceMode') !== 'personal') throw error('personal_device_required','各自端末の登録が必要です');
    if (!multi && configuration.get('recorderUid') && configuration.get('recorderUid') !== req.ctx.uid) throw error('not_recorder', 'Hostが許可した録音担当端末で実行してください', 403);
    return { ref, group, leaseKey: multi ? `${group}-${req.ctx.uid}` : String(group), multi };
  }
  async function profiles(tx: Transaction, req: AuthRequest, group: number) {
    const members = await tx.get(root(req).collection('members').where('group', '==', group));
    const roster = members.docs.filter(m => m.get('role') === 'participant' && m.get('status') === 'active');
    const voices: VoiceProfile[] = [], usedRefs: DocumentReference[] = [];
    const shared = roster.some(m => m.id === req.ctx.uid && m.get('deviceMode') === 'shared');
    for (const m of shared ? [] : roster.filter(m => m.get('deviceMode') !== 'shared')) {
      // 音声登録は任意。登録した人だけを照合し、登録していない人は推定に出さない
      const attendees = (m.get('attendees') as { id: string; displayName: string; voiceRegistered: boolean }[] | undefined) ?? [];
      for (const a of attendees.filter((x) => x.voiceRegistered)) {
        const p = await tx.get(db.doc(`users/${m.id}/voiceProfiles/default`));
        const embedding = p.get('embedding') as number[] | undefined;
        if (p.get('version') !== deps.voice!.version || !embedding?.length || embedding.some((n) => !Number.isFinite(n)) || Math.hypot(...embedding) === 0) continue;
        usedRefs.push(p.ref);
        voices.push({ uid: a.id, label: a.displayName, embedding });
      }
    }
    if (voices.length > 100) throw error('roster_invalid', 'グループの参加者を確認してください');
    const mode = shared || !voices.length ? 'anonymous' as const : 'identified' as const;
    const hash = createHash('sha256').update(JSON.stringify({ mode, version: deps.voice!.version, roster: roster.map(m => m.id).sort(), voices })).digest('hex');
    return { voices, mode, hash, usedRefs };
  }
  const temporary = (req: AuthRequest, group: number) => root(req).collection('voiceProfiles').doc(`anonymous-${group}`);
  function owns(lease: DocumentSnapshot, req: AuthRequest) {
    if (lease.get('id') !== req.params.runId || lease.get('uid') !== req.ctx.uid || lease.get('sessionId') !== req.ctx.session!.sessionId || lease.get('expiresAt') <= deps.now()) throw error('recorder_expired', '録音担当の接続が変わりました。録音を開始し直してください');
  }
  app.get('/rooms/:roomId/speaker/config', authenticate, member, wrap(async (_req, res) => res.json({ enabled: !!deps.voice, source: deps.voice?.source ?? null })));
  app.post('/rooms/:roomId/speaker/start', authenticate, member, wrap(async (req, res) => {
    parse(z.object({ consent: z.literal(true).optional() }).strict(), req.body);
    if (!deps.voice) throw error('voice_unavailable', '話者モデルの接続設定が必要です', 503);
    const result = await roomTransaction(db,req.params.roomId,async (tx) => {
      const { ref, group, leaseKey, multi } = await access(tx, req), configuration = await profiles(tx, req, group);
      const { voices, mode, hash } = configuration;
      const leaseRef = ref.collection('speakerLeases').doc(leaseKey), lease = await tx.get(leaseRef);
      const stateRef = ref.collection('speaking').doc(String(group)), state = await tx.get(stateRef);
      if (lease.exists && lease.get('expiresAt') > deps.now()) throw error('recorder_exists', 'このグループは別の接続で話者識別中です');
      for (const profile of configuration.usedRefs) tx.update(profile,{lastUsedAt:Timestamp.fromMillis(deps.now())});
      const id = randomUUID();
      const reset = !state.exists || state.get('rosterHash') !== hash || state.get('version') !== deps.voice!.version;
      tx.set(leaseRef, { id, mode, uid: req.ctx.uid, sessionId: req.ctx.session!.sessionId, expiresAt: deps.now() + 30_000, sequence: 0, startedAt: deps.now(), bytes: 0, profilesHash: hash });
      // 名簿やモデルが変わった場合は、以前の集計と混ぜない。
      if (reset) tx.set(stateRef, { group, mode, rosterHash:hash, multi, source: deps.voice!.source, version: deps.voice!.version, processedMs: 0, unknownMs: 0, talkMs: Object.fromEntries(voices.map((p) => [p.uid, 0])), members: voices.map(({ uid, label }) => ({ uid, label })), latest: null, updatedAt: deps.now() } satisfies SpeakingState);
      if (reset) tx.delete(temporary(req, group));
      return { runId: id, group, mode, sequence: 0, source: deps.voice!.source };
    });
    res.status(201).json(result);
  }));
  app.post('/rooms/:roomId/speaker/:runId/chunk', authenticate, member, express.raw({ type: 'audio/pcm', limit: 96_000 }), wrap(async (req, res) => {
    const sequence = parse(z.coerce.number().int().min(0).max(1800), req.query.sequence);
    const pcm = req.body;
    if (!Buffer.isBuffer(pcm) || ![32_000, 64_000, 96_000].includes(pcm.length)) { if (Buffer.isBuffer(pcm)) pcm.fill(0); throw error('invalid_pcm', '直近1〜3秒の16kHz mono PCM16を送信してください', 400); }
    if (!deps.voice) { pcm.fill(0); throw error('voice_unavailable', '話者モデルが利用できません', 503); }
    if (inFlight >= 12) { pcm.fill(0); throw error('speaker_busy', '話者識別の処理が混み合っています', 503); }
    inFlight++;
    try {
      const digest = createHash('sha256').update(pcm).digest('hex');
      const claim = await roomTransaction(db,req.params.roomId,async (tx) => {
        const { ref, group, leaseKey, multi } = await access(tx, req);
        const leaseRef = ref.collection('speakerLeases').doc(leaseKey), lease = await tx.get(leaseRef); owns(lease, req);
        if (sequence === lease.get('sequence') - 1 && digest === lease.get('lastDigest')) return { duplicate: true as const, group };
        if (sequence !== lease.get('sequence')) throw error('audio_sequence', '音声の送信順序を確認してください');
        if (lease.get('processingUntil') > deps.now()) throw error('speaker_busy', '音声の処理中です');
        if (lease.get('bytes') >= 30 * 60 * 32_000 || lease.get('bytes') / 32 + 1000 > deps.now() - lease.get('startedAt') + 2000) throw error('audio_rate', '実時間の速度で音声を送信してください');
        const configuration = await profiles(tx, req, group);
        if (configuration.hash !== lease.get('profilesHash')) throw error('roster_changed', '声の登録情報が変更されました');
        tx.update(leaseRef, { processingUntil: deps.now() + 20_000 });
        return { duplicate: false as const, group, multi, ...configuration };
      });
      if (claim.duplicate) { res.json({ sequence: sequence + 1 }); return; }
      // 発言時間は末尾1秒だけ。前の音声は照合の文脈に使い、二重加算しない。
      const features = await deps.voice.extract(pcm.subarray(-32_000));
      const embedding = features.embedding;
      let context: { embedding: number[] | null } | undefined;
      try {
        context = pcm.length > 32_000 && features.speechMs >= 400 && claim.mode === 'identified' ? await deps.voice.extract(pcm) : undefined;
        const speechMs = Math.max(0, Math.min(1000, features.speechMs));
        if (!Number.isFinite(features.speechMs)) throw error('speaker_invalid', '音声を解析できませんでした', 503);
        await createSessions(db, deps.now).validate(req.ctx.token!, readSessionCookie(req));
        await roomTransaction(db,req.params.roomId,async (tx) => {
          const { ref, group, leaseKey, multi } = await access(tx, req);
          const leaseRef = ref.collection('speakerLeases').doc(leaseKey), lease = await tx.get(leaseRef); owns(lease, req);
          if (sequence !== lease.get('sequence')) throw error('audio_sequence', '音声の送信順序を確認してください');
          if ((await profiles(tx, req, group)).hash !== claim.hash) throw error('roster_changed', '声の登録情報が変更されました');
          const stateRef = ref.collection('speaking').doc(String(group)), state = (await tx.get(stateRef)).data() as SpeakingState;
          const privateRef = temporary(req, group);
          const saved = claim.mode === 'anonymous' ? await tx.get(privateRef) : undefined;
          const voices: VoiceProfile[] = claim.mode === 'anonymous' ? (saved?.get('profiles') ?? []) : claim.voices;
          const match = speechMs >= 400
            ? claim.mode === 'anonymous' ? partitionSpeaker(embedding, voices) : matchContextSpeaker(embedding, context?.embedding ?? null, voices)
            : { uid: null, confidence: null };
          state.mode = claim.mode;
          state.members = voices.map(({ uid, label }) => ({ uid, label }));
          // 各自端末では同じ秒を複数の端末が聞くので、秒ごとのまとめ（speechBuckets）で二重に数えない。
          // 話者不明は、その秒に既に数えた時間を超える分だけを数える（acceptSpeech）。
          const bucketRef=ref.collection('speechBuckets').doc(`${group}-${Math.floor((lease.get('startedAt') + sequence*1000)/1000)}`);
          const stored=multi?(await tx.get(bucketRef)).data() as SpeechBucket|undefined:undefined;
          const delta: SpeechDelta=multi?acceptSpeech(stored,match.uid,speechMs):{talk:match.uid?{[match.uid]:speechMs}:{},unknown:match.uid?0:speechMs,bucket:emptyBucket()};
          if (claim.mode === 'anonymous' && voices.length) tx.set(privateRef, { profiles: voices, version: deps.voice!.version });
          if(multi)tx.set(bucketRef,{group,...delta.bucket});
          for (const [uid, ms] of Object.entries(delta.talk)) state.talkMs[uid] = (state.talkMs[uid] ?? 0) + ms;
          state.unknownMs = Math.max(0, state.unknownMs + delta.unknown);
          state.processedMs += 1000; state.updatedAt = deps.now();
          state.latest = speechMs ? { ...match, label: voices.find((p) => p.uid === match.uid)?.label ?? '話者不明' } : null;
          tx.set(stateRef, state);
          tx.set(ref.collection('speakerEvents').doc(`${group}-${req.params.runId}-${sequence}`), {group, uid:match.uid, sourceUid:req.ctx.uid, startedAt:lease.get('startedAt') + sequence * 1000, speechMs, mode:claim.mode});
          tx.update(leaseRef, { sequence: sequence + 1, bytes: lease.get('bytes') + 32_000, lastDigest: digest, processingUntil: 0, expiresAt: deps.now() + 30_000 });
        });
      } finally { embedding?.fill(0); context?.embedding?.fill(0); }
      res.json({ sequence: sequence + 1 });
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw error('speaker_unavailable', '話者識別を停止しました。元の録音は端末に残ります', 503);
    } finally { pcm.fill(0); inFlight--; }
  }));
  app.post('/rooms/:roomId/speaker/:runId/stop', authenticate, member, wrap(async (req, res) => {
    await roomTransaction(db,req.params.roomId,async (tx) => {
      const own = await tx.get(root(req).collection('members').doc(req.ctx.uid));
      if (own.get('role') !== 'participant' || !own.get('group')) throw error('group_required', '所属を確認してください', 403);
      const config=await tx.get(root(req).collection('groups').doc(String(own.get('group'))));
      const ref = root(req).collection('speakerLeases').doc(config.get('recordingMode')==='personal'?`${own.get('group')}-${req.ctx.uid}`:String(own.get('group'))), lease = await tx.get(ref);
      owns(lease, req); tx.update(ref, { expiresAt: 0 });
    });
    res.json({ ok: true });
  }));
}
