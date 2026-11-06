import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { FieldValue, type Firestore, type DocumentSnapshot } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import { z } from 'zod';
import type { Gemini } from './gemini.js';
import type { VoiceEngine } from './mvp-voice.js';

interface Attendee { id: string; name: string; registered: boolean }
type MvpRequest = Request & { uid: string };
class Failure extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const fail = (status: number, code: string, message: string): never => { throw new Failure(status, code, message); };
const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const value = schema.safeParse(body);
  if (!value.success) return fail(400, 'invalid_input', '入力内容を確認してください');
  return value.data;
};
const wrap = (fn: (req: MvpRequest, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { void fn(req as MvpRequest, res).then(() => { if (!res.headersSent) next(); }).catch(next); };
const visibility = z.object({ theme: z.boolean(), members: z.boolean(), timer: z.boolean() });
const settings = z.object({ title: z.string().trim().min(1).max(100), theme: z.string().trim().min(1).max(1000), minutes: z.number().int().min(1).max(30), groups: z.number().int().min(1).max(8), recording: z.boolean(), visible: visibility, publishOnEnd: z.boolean() }).strict();

/** 新しいMVPはAPI経由だけで読む。既存roomsやそのRulesには変更を加えない。 */
export function registerMvpRoutes(app: Express, deps: { db: Firestore; auth: Auth; gemini: Gemini; voice: VoiceEngine; now?: () => number }) {
  const { db, auth, gemini, voice } = deps, now = deps.now ?? Date.now;
  const router = express.Router();
  let expensive = 0;
  router.use(wrap(async (req, res) => {
    const token = req.header('authorization')?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return fail(401, 'login_required', 'Googleでログインしてください');
    try {
      const decoded = await auth.verifyIdToken(token, true);
      const emulator = !!process.env.FIREBASE_AUTH_EMULATOR_HOST && (process.env.GOOGLE_CLOUD_PROJECT ?? '').startsWith('demo-');
      if (decoded.firebase?.sign_in_provider !== 'google.com' && !(emulator && decoded.firebase?.sign_in_provider === 'password')) return fail(403, 'google_required', 'Googleでログインしてください');
      req.uid = decoded.uid;
      res.locals.authenticated = true;
    } catch (e) { if (e instanceof Failure) throw e; return fail(401, 'login_required', 'ログインし直してください'); }
  }), (_req, res, next) => { if (res.locals.authenticated) next(); });
  router.use('/room/:id', (req, _res, next) => /^[A-Za-z0-9_-]{1,128}$/.test(req.params.id) ? next() : next(new Failure(400, 'invalid_id', '議論のIDを確認してください')));
  const roomRef = (id: string) => db.doc(`mvpDiscussions/${id}`);
  const memberRef = (id: string, uid: string) => roomRef(id).collection('members').doc(uid);
  const profileRef = (uid: string) => db.doc(`mvpUsers/${uid}/voice/default`);
  async function access(id: string, uid: string, host = false): Promise<[DocumentSnapshot, DocumentSnapshot]> {
    const [room, member] = await db.getAll(roomRef(id), memberRef(id, uid));
    if (!room.exists || !member.exists) return fail(403, 'not_member', 'この議論には参加していません');
    if (host && member.get('role') !== 'host') return fail(403, 'host_only', 'Hostだけが操作できます');
    return [room, member];
  }
  async function end(id: string, reason: 'host' | 'timeout') {
    await db.runTransaction(async (tx) => {
      const ref = roomRef(id), room = await tx.get(ref);
      if (room.get('phase') !== 'discussing' || (reason === 'timeout' && room.get('endsAt') > now())) return;
      tx.update(ref, { phase: 'ended', endReason: reason, endedAt: reason === 'timeout' ? room.get('endsAt') : now(), published: room.get('publishOnEnd') });
    });
    // 共有端末の特徴はこの議論限り。再実行しても安全に削除できる。
    const room = await roomRef(id).get();
    if (room.get('phase') === 'ended') {
      const profiles = await roomRef(id).collection('voices').get();
      if (profiles.size) { const batch = db.batch(); profiles.docs.forEach((p) => batch.delete(p.ref)); await batch.commit(); }
    }
  }
  router.post('/create', wrap(async (req, res) => {
    const data = parse(settings, req.body), ref = db.collection('mvpDiscussions').doc();
    for (let attempt = 0; attempt < 5; attempt++) {
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', code = [...randomBytes(6)].map((n) => alphabet[n % alphabet.length]).join('');
      const created = await db.runTransaction(async (tx) => {
        const codeRef = db.doc(`mvpCodes/${code}`);
        if ((await tx.get(codeRef)).exists) return false;
        tx.create(codeRef, { discussionId: ref.id });
        tx.create(ref, { ...data, code, phase: 'waiting', published: false, createdAt: now() });
        tx.create(memberRef(ref.id, req.uid), { role: 'host', joinedAt: now() });
        tx.set(db.doc(`mvpUsers/${req.uid}/discussions/${ref.id}`), { joinedAt: now() });
        return true;
      });
      if (created) return res.status(201).json({ id: ref.id });
    }
    return fail(503, 'code_unavailable', '参加コードを作成できませんでした。再試行してください');
  }));
  router.get('/list', wrap(async (req, res) => {
    const links = await db.collection(`mvpUsers/${req.uid}/discussions`).orderBy('joinedAt', 'desc').limit(30).get();
    const rows = await Promise.all(links.docs.map(async (link) => {
      const [room, member] = await access(link.id, req.uid);
      return { id: link.id, title: room.get('title'), phase: room.get('phase'), role: member.get('role') };
    }));
    res.json({ discussions: rows });
  }));
  router.post('/join', wrap(async (req, res) => {
    const { code } = parse(z.object({ code: z.string().regex(/^[A-Z0-9]{6}$/) }).strict(), req.body);
    const found = await db.doc(`mvpCodes/${code}`).get();
    if (!found.exists) return fail(404, 'code_not_found', '参加コードが見つかりません');
    const id = found.get('discussionId') as string;
    await db.runTransaction(async (tx) => {
      const [room, own, members] = await Promise.all([tx.get(roomRef(id)), tx.get(memberRef(id, req.uid)), tx.get(roomRef(id).collection('members'))]);
      if (own.exists) return;
      if (room.get('phase') !== 'waiting') return fail(409, 'already_started', 'この議論の参加受付は終了しました');
      if (members.size >= 41) return fail(409, 'full', '参加できる端末数の上限です');
      tx.create(memberRef(id, req.uid), { role: 'guest', group: 1, attendees: [], ready: false, joinedAt: now() });
      tx.set(db.doc(`mvpUsers/${req.uid}/discussions/${id}`), { joinedAt: now() });
    });
    res.json({ id });
  }));
  router.get('/room/:id', wrap(async (req, res) => {
    await access(req.params.id, req.uid);
    await end(req.params.id, 'timeout');
    const [room, own] = await access(req.params.id, req.uid), data = room.data()!, host = own.get('role') === 'host';
    const members = await roomRef(req.params.id).collection('members').get();
    const peers = members.docs.filter((m) => m.get('role') === 'guest' && (host || m.get('group') === own.get('group')));
    const allResults = host || data.published ? await roomRef(req.params.id).collection('results').get() : null;
    const results = allResults?.docs.filter((r) => host || r.id === String(own.get('group'))).map((r) => ({ group: Number(r.id), ...r.data() })) ?? [];
    const allJobs = host || data.phase === 'ended' ? await roomRef(req.params.id).collection('jobs').get() : null;
    res.setHeader('cache-control', 'no-store');
    res.json({
      id: room.id, role: own.get('role'), title: data.title, phase: data.phase,
      theme: host || data.visible.theme ? data.theme : null, endsAt: host || data.visible.timer ? data.endsAt ?? null : null,
      minutes: host ? data.minutes : undefined, groups: data.groups, code: host ? data.code : undefined,
      recording: data.recording, published: data.published, endReason: data.endReason ?? null,
      visible: data.visible, publishOnEnd: host ? data.publishOnEnd : undefined,
      own: { group: own.get('group') ?? null, mode: own.get('mode') ?? null, attendees: own.get('attendees') ?? [], ready: own.get('ready') ?? false },
      members: host || data.visible.members ? peers.map((m) => ({ uid: host ? m.id : undefined, group: m.get('group'), attendees: m.get('attendees') ?? [], ready: m.get('ready') })) : [],
      results, jobs: allJobs?.docs.filter((j) => host || j.id === String(own.get('group'))).map((j) => ({ group: Number(j.id), status: j.get('status') })) ?? [],
      source: gemini.source, voiceSource: voice.source,
    });
  }));
  router.post('/room/:id/names', wrap(async (req, res) => {
    const body = parse(z.object({ mode: z.enum(['personal', 'shared']), names: z.array(z.string().trim().min(1).max(40)).min(1).max(8), group: z.number().int().min(1).max(8) }).strict().refine((b) => b.mode === 'shared' || b.names.length === 1), req.body);
    const profile = await profileRef(req.uid).get(), reusable = body.mode === 'personal' && profile.get('version') === voice.version;
    await db.runTransaction(async (tx) => {
      const [room, own] = await tx.getAll(roomRef(req.params.id), memberRef(req.params.id, req.uid));
      if (!own.exists || own.get('role') !== 'guest') return fail(403, 'guest_only', 'Guestとして参加してください');
      if (room.get('phase') !== 'waiting' || body.group > room.get('groups')) return fail(409, 'settings_locked', '開始前に所属と表示名を設定してください');
      tx.update(own.ref, { mode: body.mode, group: body.group, ready: reusable, attendees: body.names.map((name) => ({ id: randomUUID(), name, registered: reusable })) });
    });
    res.json({ ok: true });
  }));
  router.post('/room/:id/voice/:attendee', express.raw({ type: 'audio/pcm', limit: 384000 }), wrap(async (req, res) => {
    const [room, own] = await access(req.params.id, req.uid);
    if (own.get('role') !== 'guest' || req.query.consent !== '1') return fail(403, 'consent_required', '本人の音声登録への同意を確認してください');
    const pcm = req.body;
    if (!Buffer.isBuffer(pcm) || pcm.length < 256000 || pcm.length % 2) return fail(400, 'invalid_audio', '8〜12秒の音声を登録してください');
    if (room.get('phase') !== 'waiting') return fail(409, 'already_started', '音声登録の受付は終了しました');
    const rows = own.get('attendees') as Attendee[];
    if (!rows.some((a) => a.id === req.params.attendee)) return fail(404, 'attendee_not_found', '参加者を確認してください');
    if (expensive >= 2) return fail(429, 'busy', '処理中です。少し待って再試行してください');
    expensive++;
    let embedding: number[];
    try { embedding = await voice.extract(pcm); } catch { return fail(503, 'voice_unavailable', '声を登録できませんでした。静かな場所で再試行してください'); }
    finally { expensive--; pcm.fill(0); }
    await db.runTransaction(async (tx) => {
      const [latest, current] = await tx.getAll(room.ref, own.ref);
      if (latest.get('phase') !== 'waiting') return fail(409, 'already_started', '音声登録の受付は終了しました');
      const attendees = current.get('attendees') as Attendee[];
      if (!attendees.some((a) => a.id === req.params.attendee)) return fail(409, 'names_changed', '表示名が変更されました。登録し直してください');
      const next = attendees.map((a) => a.id === req.params.attendee ? { ...a, registered: true } : a);
      const target = current.get('mode') === 'personal' ? profileRef(req.uid) : room.ref.collection('voices').doc(`${req.uid}-${req.params.attendee}`);
      tx.set(target, { version: voice.version, embedding, createdAt: now() });
      tx.update(own.ref, { attendees: next, ready: next.every((a) => a.registered) });
    });
    res.json({ ok: true, source: voice.source });
  }));
  router.post('/voice/delete', wrap(async (req, res) => { await profileRef(req.uid).delete(); res.json({ ok: true }); }));
  router.post('/room/:id/settings', wrap(async (req, res) => {
    await access(req.params.id, req.uid, true);
    const body = parse(settings.partial().omit({ groups: true }).extend({ published: z.boolean().optional() }).strict(), req.body);
    await db.runTransaction(async (tx) => {
      const ref = roomRef(req.params.id), room = await tx.get(ref);
      if (room.get('phase') !== 'waiting' && Object.keys(body).some((k) => !['visible', 'published', 'publishOnEnd'].includes(k))) return fail(409, 'settings_locked', '開始後は表示・公開設定だけ変更できます');
      tx.update(ref, body);
    });
    res.json({ ok: true });
  }));
  router.post('/room/:id/start', wrap(async (req, res) => {
    await access(req.params.id, req.uid, true);
    await db.runTransaction(async (tx) => {
      const ref = roomRef(req.params.id), room = await tx.get(ref), members = await tx.get(ref.collection('members'));
      if (room.get('phase') !== 'waiting') return fail(409, 'already_started', 'この議論は開始済みです');
      const guests = members.docs.filter((m) => m.get('role') === 'guest');
      if (!guests.length || guests.some((m) => !m.get('ready'))) return fail(409, 'not_ready', '参加者全員の表示名・音声登録を待ってください');
      tx.update(ref, { phase: 'discussing', startedAt: now(), endsAt: now() + room.get('minutes') * 60_000 });
    });
    res.json({ ok: true });
  }));
  router.post('/room/:id/finish', wrap(async (req, res) => { await access(req.params.id, req.uid, true); await end(req.params.id, 'host'); res.json({ ok: true }); }));
  router.post('/room/:id/claim-recording', wrap(async (req, res) => {
    await end(req.params.id, 'timeout');
    const [room, own] = await access(req.params.id, req.uid);
    if (own.get('role') !== 'guest' || !own.get('ready') || !room.get('recording')) return fail(403, 'recording_forbidden', '録音可能なGuestではありません');
    const runId = await db.runTransaction(async (tx) => {
      const latest = await tx.get(room.ref), ref = room.ref.collection('recorders').doc(String(own.get('group'))), recorder = await tx.get(ref);
      if (latest.get('phase') !== 'discussing') return fail(409, 'not_discussing', '議論中だけ録音できます');
      if (recorder.exists && recorder.get('uid') !== req.uid) return fail(409, 'other_recorder', 'このグループの録音は別の端末が担当しています');
      const runId = recorder.get('runId') ?? randomUUID();
      tx.set(ref, { uid: req.uid, runId }); return runId as string;
    });
    res.json({ runId });
  }));
  router.post('/room/:id/recording', express.raw({ type: () => true, limit: '12mb' }), wrap(async (req, res) => {
    await access(req.params.id, req.uid);
    await end(req.params.id, 'timeout');
    const [room, own] = await access(req.params.id, req.uid);
    if (own.get('role') !== 'guest' || room.get('recording') !== true || req.query.consent !== '1') return fail(403, 'recording_forbidden', '録音への同意と担当を確認してください');
    if (room.get('phase') !== 'ended' || now() > room.get('endedAt') + 5 * 60_000) return fail(409, 'upload_window', '終了後5分以内に録音を送信してください');
    const recorder = await room.ref.collection('recorders').doc(String(own.get('group'))).get();
    if (recorder.get('uid') !== req.uid || recorder.get('runId') !== req.query.runId) return fail(403, 'recorder_only', 'このグループの録音担当端末から送信してください');
    const audio = req.body, mimeType = (req.header('content-type') ?? '').split(';')[0];
    const durationSec = parse(z.coerce.number().min(1).max(1800), req.query.seconds);
    if (!Buffer.isBuffer(audio) || audio.length < 128 || !['audio/webm', 'audio/mp4', 'audio/wav', 'audio/ogg'].includes(mimeType)) return fail(415, 'invalid_audio', '対応する録音ファイルを送信してください');
    const group = own.get('group'), jobRef = room.ref.collection('jobs').doc(String(group)), resultRef = room.ref.collection('results').doc(String(group));
    const digest = createHash('sha256').update(audio).digest('hex'), job = randomUUID();
    if (expensive >= 2) return fail(429, 'busy', 'ほかの録音を分析中です。再試行してください');
    const duplicate = await db.runTransaction(async (tx) => {
      const existing = await tx.get(jobRef);
      if (existing.get('status') === 'done') return true;
      if (existing.get('status') === 'running' && now() - existing.get('startedAt') < 240000) return fail(409, 'analyzing', '同じグループの録音を分析中です');
      if (existing.exists && now() - existing.get('startedAt') < 30000) return fail(429, 'cooldown', '30秒待ってから録音を再送してください');
      if ((existing.get('attempts') ?? 0) >= 3) return fail(429, 'attempt_limit', '録音の分析回数の上限です');
      tx.set(jobRef, { status: 'running', job, digest, attempts: (existing.get('attempts') ?? 0) + 1, startedAt: now() });
      return false;
    });
    if (duplicate) return res.json({ ok: true, duplicate: true });
    expensive++;
    try {
      const result = await gemini.analyzeDiscussion({ audio, mimeType, durationSec, theme: room.get('theme') });
      await db.runTransaction(async (tx) => {
        const current = await tx.get(jobRef);
        if (current.get('job') !== job) return;
        tx.set(resultRef, { ...result, source: gemini.source, durationSec, createdAt: now() });
        tx.update(jobRef, { status: 'done' });
      });
      res.json({ ok: true });
    } catch {
      await db.runTransaction(async (tx) => { if ((await tx.get(jobRef)).get('job') === job) tx.update(jobRef, { status: 'failed' }); });
      return fail(503, 'analysis_failed', '分析に失敗しました。録音を端末に残したまま再送できます');
    } finally { expensive--; audio.fill(0); }
  }));
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof Failure) return void res.status(error.status).json({ error: { code: error.code, message: error.message } });
    if ((error as { type?: string })?.type === 'entity.too.large') return void res.status(413).json({ error: { code: 'too_large', message: '音声ファイルが大きすぎます' } });
    // トークン・入力本文・音声特徴を例外ログに出さない。
    console.error('MVP request failed');
    res.status(500).json({ error: { code: 'internal', message: '処理に失敗しました。再試行してください' } });
  });
  app.use('/discussions', router);
}
