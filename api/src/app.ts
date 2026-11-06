import express, { type NextFunction, type Request, type Response } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Auth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import type { Gemini } from './gemini.js';
import { alignmentRate, interventionEffectiveness, participationFairness, reflectionRate } from './metrics.js';

export const PHASES = ['collecting', 'discussing', 'consensus', 'closed'] as const;
export const ANALYZE_COOLDOWN_MS = 30_000;
export const MAX_GROUPS = 12;
const RUNNING_TIMEOUT_MS = 60_000;

type Role = 'moderator' | 'participant';
interface Ctx { uid: string; provider: string; role?: Role }
type Req = Request & { ctx: Ctx };

/** メンバーのグループ番号。グループが1つの部屋（と、グループ導入前の部屋）は 1。複数で未選択なら undefined */
function groupNumber(m: { get(field: string): unknown }, groups: number | undefined): number | undefined {
  const g = m.get('group') as number | undefined;
  return g ?? ((groups ?? 1) <= 1 ? 1 : undefined);
}

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly extra: object = {}) { super(message); }
}
const wrap = (fn: (req: Req, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req as Req, res).catch(next); };

export function createApp(deps: { db: Firestore; auth: Auth; gemini: Gemini; now?: () => number }) {
  const { db, auth, gemini } = deps;
  const now = deps.now ?? Date.now;
  const app = express();
  app.use(express.json({ limit: '32kb' }));

  const run = (fn: (req: Req, res: Response) => Promise<void>) =>
    (req: Request, res: Response, next: NextFunction) => {
      fn(req as Req, res).then(() => { if (!res.headersSent) next(); }).catch(next);
    };
  // 認証：ID トークンを検証する（/health 以外）
  const authenticate = run(async (req) => {
    const token = req.header('authorization')?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw new HttpError(401, 'unauthenticated', 'ログインが必要です');
    try {
      const decoded = await auth.verifyIdToken(token);
      req.ctx = { uid: decoded.uid, provider: decoded.firebase?.sign_in_provider ?? 'unknown' };
    } catch {
      throw new HttpError(401, 'unauthenticated', 'ID トークンが無効です');
    }
  });
  const chain = (...fns: ((req: Request, res: Response, next: NextFunction) => void)[]) => fns;
  // 所属確認：パスの roomId のメンバーか
  const member = run(async (req) => {
    const snap = await db.doc(`rooms/${req.params.roomId}/members/${req.ctx.uid}`).get();
    if (!snap.exists) throw new HttpError(403, 'not_member', 'この部屋のメンバーではありません');
    req.ctx.role = snap.get('role');
  });
  // 司会者確認
  const moderator = run(async (req) => {
    if (req.ctx.role !== 'moderator') throw new HttpError(403, 'not_moderator', '司会者だけが実行できます');
  });
  const roomRef = (id: string) => db.doc(`rooms/${id}`);
  async function requirePhase(roomId: string, phase: (typeof PHASES)[number]) {
    const room = await roomRef(roomId).get();
    if (!room.exists) throw new HttpError(404, 'room_not_found', '部屋がありません');
    if (room.get('phase') !== phase) throw new HttpError(409, 'wrong_phase', `フェーズが ${phase} ではありません`);
    return room;
  }
  const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
    const r = schema.safeParse(body);
    if (!r.success) throw new HttpError(400, 'bad_request', r.error.issues.map((i) => i.message).join(', '));
    return r.data;
  };

  // 稼働確認。Cloud Run は z で終わるパス（/healthz など）を予約していてコンテナに届かないので、/health を使う。
  // /healthz は手元と古い手順のために残す
  app.get(['/health', '/healthz'], (_req, res) => { res.json({ ok: true, gemini: gemini.source }); });

  // 部屋の作成：匿名でないログインが必要。所属はまだないので所属確認はしない
  app.post('/rooms', ...chain(authenticate, wrap(async (req, res) => {
    if (req.ctx.provider === 'anonymous') throw new HttpError(403, 'moderator_login_required', '司会者は Google でログインしてください');
    const { title, groups } = parse(z.object({ title: z.string().trim().min(1).max(100), groups: z.number().int().min(1).max(MAX_GROUPS).default(1) }), req.body);
    const roomId = db.collection('rooms').doc().id;
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let attempt = 0; attempt < 5; attempt++) {
      const joinCode = Array.from(randomBytes(6), (b) => alphabet[b % alphabet.length]).join('');
      const ok = await db.runTransaction(async (tx) => {
        const codeRef = db.doc(`joinCodes/${joinCode}`);
        if ((await tx.get(codeRef)).exists) return false;
        tx.set(codeRef, { roomId });
        tx.set(roomRef(roomId), { title, groups, phase: 'collecting', joinCode, createdBy: req.ctx.uid, createdAt: FieldValue.serverTimestamp(), analysis: { status: 'idle' } });
        tx.set(db.doc(`rooms/${roomId}/members/${req.ctx.uid}`), { role: 'moderator', joinedAt: FieldValue.serverTimestamp() });
        return true;
      });
      if (ok) { res.status(201).json({ roomId, joinCode }); return; }
    }
    throw new HttpError(503, 'join_code_exhausted', '参加コードを作れませんでした。もう一度試してください');
  })));

  // 参加：参加前なので所属確認はしない。参加コードで部屋を特定し、participant として登録する
  app.post('/rooms/join', ...chain(authenticate, wrap(async (req, res) => {
    const { code } = parse(z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6}$/, '参加コードは6文字です') }), req.body);
    const codeSnap = await db.doc(`joinCodes/${code}`).get();
    if (!codeSnap.exists) throw new HttpError(404, 'join_code_not_found', '参加コードが見つかりません');
    const roomId = codeSnap.get('roomId') as string;
    await db.runTransaction(async (tx) => {
      const room = await tx.get(roomRef(roomId));
      if (!room.exists || room.get('phase') === 'closed') throw new HttpError(409, 'room_closed', 'この部屋は終了しています');
      const mRef = db.doc(`rooms/${roomId}/members/${req.ctx.uid}`);
      if (!(await tx.get(mRef)).exists) {
        // グループが1つなら自動でグループ1。複数なら、参加のあとに生徒が自分で選ぶ（groups/choose）
        tx.set(mRef, { role: 'participant', ...((room.get('groups') ?? 1) <= 1 ? { group: 1 } : {}), joinedAt: FieldValue.serverTimestamp() });
      }
    });
    res.json({ roomId });
  })));

  // フェーズを1つ進める（司会者）
  app.post('/rooms/:roomId/phase', ...chain(authenticate, member, moderator, wrap(async (req, res) => {
    const { to } = parse(z.object({ to: z.enum(PHASES) }), req.body);
    await db.runTransaction(async (tx) => {
      const room = await tx.get(roomRef(req.params.roomId));
      const cur = PHASES.indexOf(room.get('phase'));
      if (PHASES.indexOf(to) !== cur + 1) throw new HttpError(409, 'wrong_phase', `${room.get('phase')} から ${to} には進めません`);
      tx.update(roomRef(req.params.roomId), { phase: to, [`phaseChangedAt.${to}`]: FieldValue.serverTimestamp() });
    });
    res.json({ phase: to });
  })));

  // 未検討論点の分析（司会者）。複数インスタンスでも重複しないよう、部屋ドキュメントのトランザクションで排他する
  app.post('/rooms/:roomId/analyze', ...chain(authenticate, member, moderator, wrap(async (req, res) => {
    const roomId = req.params.roomId;
    // グループごとに進むので、授業中（collecting・discussing）ならいつでも分析できる
    const roomSnap = await roomRef(roomId).get();
    if (!roomSnap.exists) throw new HttpError(404, 'room_not_found', '部屋がありません');
    if (!['collecting', 'discussing'].includes(roomSnap.get('phase'))) throw new HttpError(409, 'wrong_phase', '授業中ではありません');
    const jobId = randomUUID();
    await db.runTransaction(async (tx) => {
      const a = (await tx.get(roomRef(roomId))).get('analysis') ?? {};
      const started = a.startedAt instanceof Timestamp ? a.startedAt.toMillis() : 0;
      if (a.status === 'running' && now() - started < RUNNING_TIMEOUT_MS) throw new HttpError(409, 'analysis_in_progress', '分析中です');
      const wait = ANALYZE_COOLDOWN_MS - (now() - started);
      if (wait > 0) throw new HttpError(429, 'cooldown', `あと ${Math.ceil(wait / 1000)} 秒待ってください`, { retryAfterSec: Math.ceil(wait / 1000) });
      tx.update(roomRef(roomId), { analysis: { status: 'running', jobId, startedAt: Timestamp.fromMillis(now()) } });
    });
    const [ops, msgs] = await Promise.all([
      db.collection(`rooms/${roomId}/privateOpinions`).get(),
      db.collection(`rooms/${roomId}/messages`).orderBy('createdAt').get(),
    ]);
    let points;
    try {
      points = await gemini.findPoints(ops.docs.map((d) => d.get('text')), msgs.docs.map((d) => d.get('text')));
    } catch (e) {
      await db.runTransaction(async (tx) => {
        if ((await tx.get(roomRef(roomId))).get('analysis.jobId') === jobId)
          tx.update(roomRef(roomId), { 'analysis.status': 'failed', 'analysis.error': String((e as Error).message).slice(0, 200) });
      });
      throw new HttpError(503, 'gemini_unavailable', 'AI の提案は一時停止中です。議論はそのまま続けられます');
    }
    // 遅れて返った古い結果は捨てる（jobId が今の分析と一致するときだけ保存）
    const saved = await db.runTransaction(async (tx) => {
      const room = await tx.get(roomRef(roomId));
      if (room.get('analysis.jobId') !== jobId) return false;
      for (const p of points.filter((x) => !x.discussed)) {
        tx.set(db.collection(`rooms/${roomId}/insights`).doc(), { summary: p.summary, status: 'pending', jobId, source: gemini.source, createdAt: FieldValue.serverTimestamp() });
      }
      tx.set(db.doc(`rooms/${roomId}/results/coverage`), {
        total: points.length, discussed: points.filter((x) => x.discussed).length,
        reflectionRate: reflectionRate(points), source: gemini.source, jobId, updatedAt: FieldValue.serverTimestamp(),
      });
      tx.update(roomRef(roomId), { 'analysis.status': 'done', 'analysis.finishedAt': FieldValue.serverTimestamp() });
      return true;
    });
    if (!saved) throw new HttpError(409, 'stale_result', '新しい分析が始まったため、この結果は破棄しました');
    res.json({ jobId, suggested: points.filter((x) => !x.discussed).length, total: points.length });
  })));

  // 提出状況（司会者）。非公開の事前意見と合意の一文は、本文を返さず件数だけを返す
  app.post('/rooms/:roomId/progress', ...chain(authenticate, member, moderator, wrap(async (req, res) => {
    const roomId = req.params.roomId;
    const [room, members, opinions, statements] = await Promise.all([
      roomRef(roomId).get(),
      db.collection(`rooms/${roomId}/members`).where('role', '==', 'participant').get(),
      db.collection(`rooms/${roomId}/privateOpinions`).select().get(),
      db.collection(`rooms/${roomId}/consensusStatements`).select().get(),
    ]);
    const groupOf = new Map(members.docs.map((m) => [m.id, groupNumber(m, room.get('groups'))]));
    const byGroup = Array.from({ length: room.get('groups') ?? 1 }, (_, i) => ({ group: i + 1, participants: 0, opinions: 0, statements: 0 }));
    const at = (uid: string) => { const g = groupOf.get(uid); return g ? byGroup[g - 1] : undefined; };
    for (const m of members.docs) { const g = at(m.id); if (g) g.participants++; }
    for (const d of opinions.docs) { const g = groupOf.has(d.id) ? at(d.id) : undefined; if (g) g.opinions++; }
    for (const d of statements.docs) { const g = groupOf.has(d.id) ? at(d.id) : undefined; if (g) g.statements++; }
    res.json({ participants: members.size, opinions: opinions.size, statements: statements.size, byGroup });
  })));

  // 提案の承認（司会者）
  app.post('/rooms/:roomId/insights/:insightId/approve', ...chain(authenticate, member, moderator, wrap(async (req, res) => {
    const ref = db.doc(`rooms/${req.params.roomId}/insights/${req.params.insightId}`);
    await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists) throw new HttpError(404, 'insight_not_found', '提案がありません');
      if (s.get('status') !== 'pending') throw new HttpError(409, 'already_decided', 'この提案は処理済みです');
      tx.update(ref, { status: 'approved', approvedAt: FieldValue.serverTimestamp() });
    });
    res.json({ status: 'approved' });
  })));

  // ---- グループごとの進行 ----
  // グループはそれぞれのペースで進む。先生が一斉に開くことはしない。
  //   opinions（メンバー集め・事前意見）→ 全員の事前意見がそろう → discussing（議論）
  //   → 生徒のだれかが終える → consensus（結論の一文）→ 全員の一文がそろう → done（結果）
  // 状態と人数は部屋ドキュメントの groupState.{番号} = { status, total, opinions, submitted } に入る（本文は含めない）
  const participantOnly = run(async (req) => {
    if (req.ctx.role !== 'participant') throw new HttpError(403, 'participant_only', '生徒だけが実行できます');
  });
  async function groupMembers(roomId: string, group: number) {
    const groups = (await roomRef(roomId).get()).get('groups');
    const ms = await db.collection(`rooms/${roomId}/members`).where('role', '==', 'participant').get();
    return ms.docs.filter((m) => groupNumber(m, groups) === group).map((m) => m.id);
  }
  async function myGroup(roomId: string, uid: string) {
    const groups = (await roomRef(roomId).get()).get('groups');
    const g = groupNumber(await db.doc(`rooms/${roomId}/members/${uid}`).get(), groups);
    if (!g) throw new HttpError(409, 'no_group', '先にグループを選んでください');
    return g;
  }
  const statusOf = (room: FirebaseFirestore.DocumentSnapshot, g: number) =>
    ((room.get('groupState')?.[g]?.status as string | undefined) ?? 'opinions');

  /** グループの人数と提出数を数え直し、そろっていれば次の段階へ進める */
  async function refreshGroup(roomId: string, group: number, opts: { forceStart?: boolean } = {}) {
    const uids = await groupMembers(roomId, group);
    const [ops, stmts] = await Promise.all([
      db.collection(`rooms/${roomId}/privateOpinions`).select().get(),
      db.collection(`rooms/${roomId}/consensusStatements`).select().get(),
    ]);
    const opinions = ops.docs.filter((d) => uids.includes(d.id)).length;
    const submitted = stmts.docs.filter((d) => uids.includes(d.id)).length;
    const status = statusOf(await roomRef(roomId).get(), group);
    const start = status === 'opinions' && uids.length > 0 && (opts.forceStart || opinions >= uids.length);
    await roomRef(roomId).set({ groupState: { [group]: {
      total: uids.length, opinions, submitted,
      ...(start ? { status: 'discussing', startedAt: FieldValue.serverTimestamp() } : {}),
    } } }, { merge: true });
    if (status === 'consensus' && uids.length > 0 && submitted >= uids.length) return analyzeGroup(roomId, group);
    return { total: uids.length, opinions, submitted, started: start };
  }

  /**
   * そのグループの一文を分析して results/group-{番号} に保存する。Gemini の呼び出しを増やしすぎないよう、
   * - 結果が出た（done）グループは、先生の出し直し（force）でなければ分析し直さない
   * - 分析はグループごとに同時に1つだけ。始めるときに jobId を書き、保存するときに一致を確かめて古い結果を捨てる
   * - 出し直しは、前の分析の開始から30秒あける（manual なら 429、自動なら何もしない）
   */
  async function analyzeGroup(roomId: string, group: number, opts: { force?: boolean; manual?: boolean } = {}) {
    const uids = await groupMembers(roomId, group);
    const stmts = (await db.collection(`rooms/${roomId}/consensusStatements`).get()).docs.filter((d) => uids.includes(d.id));
    await roomRef(roomId).set({ groupState: { [group]: { submitted: stmts.length, total: uids.length } } }, { merge: true });
    const ready = uids.length > 0 && stmts.length >= uids.length;
    const base = { ready, analyzed: false, submitted: stmts.length, total: uids.length };
    if ((!ready && !opts.force) || stmts.length === 0) return base;
    const jobId = randomUUID();
    const claim = await db.runTransaction(async (tx) => {
      const st = (await tx.get(roomRef(roomId))).get('groupState')?.[group] ?? {};
      if (st.status === 'done' && !opts.force) return { skip: 'done' as const };
      const a = st.analysis ?? {};
      const started = a.startedAt instanceof Timestamp ? a.startedAt.toMillis() : 0;
      if (a.running && now() - started < RUNNING_TIMEOUT_MS) return { skip: 'running' as const };
      const wait = ANALYZE_COOLDOWN_MS - (now() - started);
      if (wait > 0) return { skip: 'cooldown' as const, wait };
      tx.set(roomRef(roomId), { groupState: { [group]: { analysis: { jobId, running: true, startedAt: Timestamp.fromMillis(now()) } } } }, { merge: true });
      return { skip: undefined };
    });
    if (claim.skip === 'cooldown' && opts.manual) {
      const sec = Math.ceil((claim.wait ?? 0) / 1000);
      throw new HttpError(429, 'cooldown', `あと ${sec} 秒待ってください`, { retryAfterSec: sec });
    }
    if (claim.skip) return { ...base, skipped: claim.skip };
    // 保存や後片付けは、今の分析（jobId が一致）のときだけ行う
    const finishIfMine = (write: (tx: FirebaseFirestore.Transaction) => void) => db.runTransaction(async (tx) => {
      const st = (await tx.get(roomRef(roomId))).get('groupState')?.[group] ?? {};
      if (st.analysis?.jobId !== jobId) return false;
      write(tx);
      return true;
    });
    let cmp;
    try {
      cmp = await gemini.compare(stmts.map((d) => d.get('text') as string), [], []);
    } catch {
      await finishIfMine((tx) => tx.set(roomRef(roomId), { groupState: { [group]: { analysis: { running: false } } } }, { merge: true }));
      return { ...base, error: 'gemini_unavailable' };
    }
    const clusters = cmp.groups.map((c) => ({ label: c.label, count: new Set(c.members).size })).filter((c) => c.count > 0);
    const saved = await finishIfMine((tx) => {
      tx.set(db.doc(`rooms/${roomId}/results/group-${group}`), {
        group, respondents: stmts.length, clusters, alignmentRate: alignmentRate(cmp.groups, stmts.length),
        source: gemini.source, jobId, updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(roomRef(roomId), { groupState: { [group]: { status: 'done', analysis: { running: false } } } }, { merge: true });
    });
    return { ...base, analyzed: saved, ...(saved ? {} : { skipped: 'stale' }) };
  }

  // グループを選ぶ（生徒）。議論を始めたグループには入れない。自分のグループが始まったあとは移れない
  app.post('/rooms/:roomId/groups/choose', ...chain(authenticate, member, participantOnly, wrap(async (req, res) => {
    const roomId = req.params.roomId;
    const room = await roomRef(roomId).get();
    if (room.get('phase') === 'closed') throw new HttpError(409, 'room_closed', 'この部屋は終了しています');
    const { group } = parse(z.object({ group: z.number().int().min(1).max(room.get('groups') ?? 1) }), req.body);
    const mRef = db.doc(`rooms/${roomId}/members/${req.ctx.uid}`);
    const prev = groupNumber(await mRef.get(), room.get('groups'));
    if (prev === group) { res.json({ group }); return; }
    if (statusOf(room, group) !== 'opinions') throw new HttpError(409, 'group_started', 'このグループはもう議論を始めています');
    if (prev && statusOf(room, prev) !== 'opinions') throw new HttpError(409, 'group_started', '自分のグループが議論を始めたので、移れません');
    await mRef.update({ group });
    if (prev) await refreshGroup(roomId, prev);
    await refreshGroup(roomId, group);
    res.json({ group });
  })));

  // 事前の意見を出す（生徒）。グループ全員がそろうと、そのグループの議論が始まる
  app.post('/rooms/:roomId/opinion', ...chain(authenticate, member, participantOnly, wrap(async (req, res) => {
    const roomId = req.params.roomId;
    const { text } = parse(z.object({ text: z.string().trim().min(1).max(1000) }), req.body);
    const group = await myGroup(roomId, req.ctx.uid);
    const room = await roomRef(roomId).get();
    if (room.get('phase') === 'closed' || statusOf(room, group) !== 'opinions')
      throw new HttpError(409, 'wrong_phase', 'グループの議論が始まったので、事前の意見は変えられません');
    await db.doc(`rooms/${roomId}/privateOpinions/${req.ctx.uid}`).set({ text, updatedAt: FieldValue.serverTimestamp() });
    res.json({ group, ...(await refreshGroup(roomId, group)) });
  })));

  // 今いるメンバーでグループの議論を始める（司会者）。休みの人がいて止まったグループのため
  app.post('/rooms/:roomId/groups/start', ...chain(authenticate, member, moderator, wrap(async (req, res) => {
    const roomId = req.params.roomId;
    const groups = (await roomRef(roomId).get()).get('groups') ?? 1;
    const { group } = parse(z.object({ group: z.number().int().min(1).max(groups) }), req.body);
    const r = await refreshGroup(roomId, group, { forceStart: true });
    res.json({ group, ...r });
  })));

  // 自分のグループの議論を終える（生徒）。グループは結論の一文の記入に進む。2回目以降は何もしない
  app.post('/rooms/:roomId/groups/end', ...chain(authenticate, member, participantOnly, wrap(async (req, res) => {
    const roomId = req.params.roomId;
    const group = await myGroup(roomId, req.ctx.uid);
    await db.runTransaction(async (tx) => {
      const room = await tx.get(roomRef(roomId));
      if (!room.exists) throw new HttpError(404, 'room_not_found', '部屋がありません');
      const status = statusOf(room, group);
      if (status === 'consensus' || status === 'done') return;
      if (status !== 'discussing') throw new HttpError(409, 'wrong_phase', 'グループの議論がまだ始まっていません');
      tx.set(roomRef(roomId), { groupState: { [group]: { status: 'consensus', endedAt: FieldValue.serverTimestamp() } } }, { merge: true });
    });
    res.json({ group, status: 'consensus', ...(await refreshGroup(roomId, group)) });
  })));

  // 結論の一文を出す（生徒）。グループが議論を終えたあと、または部屋が合意の確認に進んだあとに受け付ける。
  // グループ全員がそろったら、そのグループの結果を自動で出す
  app.post('/rooms/:roomId/statement', ...chain(authenticate, member, participantOnly, wrap(async (req, res) => {
    const roomId = req.params.roomId;
    const body = parse(z.object({
      text: z.string().trim().min(1).max(300),
      agreement: z.number().int().min(1).max(5),
      concern: z.string().trim().max(300).optional(),
    }), req.body);
    const group = await myGroup(roomId, req.ctx.uid);
    const room = await roomRef(roomId).get();
    const status = statusOf(room, group);
    if (!(room.get('phase') === 'consensus' || status === 'consensus' || status === 'done'))
      throw new HttpError(409, 'wrong_phase', 'グループの議論が終わってから書いてください');
    await db.doc(`rooms/${roomId}/consensusStatements/${req.ctx.uid}`).set({
      text: body.text, agreement: body.agreement, ...(body.concern ? { concern: body.concern } : {}), updatedAt: FieldValue.serverTimestamp(),
    });
    res.json({ group, ...(await analyzeGroup(roomId, group)) });
  })));

  // グループの結果を出し直す。生徒は自分のグループ（全員そろっているときだけ）、先生は任意のグループを今ある回答で出せる
  app.post('/rooms/:roomId/groups/analyze', ...chain(authenticate, member, wrap(async (req, res) => {
    const roomId = req.params.roomId;
    const isMod = req.ctx.role === 'moderator';
    const groups = (await roomRef(roomId).get()).get('groups') ?? 1;
    const group = isMod
      ? parse(z.object({ group: z.number().int().min(1).max(groups) }), req.body).group
      : await myGroup(roomId, req.ctx.uid);
    // 生徒は全員そろったときだけ、先生は今ある回答でも出せる。どちらも30秒あける
    const r = await analyzeGroup(roomId, group, { force: isMod, manual: true });
    if ('error' in r) throw new HttpError(503, 'gemini_unavailable', 'AI の分析は一時停止中です。少し待ってから再実行してください');
    res.json({ group, ...r });
  })));

  // 合意の実態検証と4つの指標（司会者）
  app.post('/rooms/:roomId/consensus/analyze', ...chain(authenticate, member, moderator, wrap(async (req, res) => {
    const roomId = req.params.roomId;
    await requirePhase(roomId, 'consensus');
    const [stmts, approved, msgs, members, coverage] = await Promise.all([
      db.collection(`rooms/${roomId}/consensusStatements`).get(),
      db.collection(`rooms/${roomId}/insights`).where('status', '==', 'approved').get(),
      db.collection(`rooms/${roomId}/messages`).orderBy('createdAt').get(),
      db.collection(`rooms/${roomId}/members`).where('role', '==', 'participant').get(),
      db.doc(`rooms/${roomId}/results/coverage`).get(),
    ]);
    const firstApproval = Math.min(...approved.docs.map((d) => (d.get('approvedAt') as Timestamp | undefined)?.toMillis() ?? Infinity));
    const after = msgs.docs.filter((d) => ((d.get('createdAt') as Timestamp | undefined)?.toMillis() ?? 0) >= firstApproval).map((d) => d.get('text') as string);
    let cmp;
    try {
      cmp = await gemini.compare(stmts.docs.map((d) => d.get('text')), approved.docs.map((d) => ({ id: d.id, summary: d.get('summary') })), after);
    } catch {
      throw new HttpError(503, 'gemini_unavailable', 'AI の分析は一時停止中です。少し待ってから再実行してください');
    }
    const counts = members.docs.map((m) => msgs.docs.filter((d) => d.get('uid') === m.id).length);
    // クラス内のグループごとに、合意の一文がどのまとまりに入ったかを数える（Gemini の呼び出しは増やさない）
    const roomGroups = (await roomRef(roomId).get()).get('groups');
    const groupOf = new Map(members.docs.map((m) => [m.id, groupNumber(m, roomGroups)]));
    const clusterOf = new Map<number, number>();
    cmp.groups.forEach((g, ci) => g.members.forEach((i) => clusterOf.set(i, ci)));
    const groupCount = (await roomRef(roomId).get()).get('groups') ?? 1;
    const byGroup = Array.from({ length: groupCount }, (_, gi) => {
      const idx = stmts.docs.map((d, i) => [d.id, i] as const).filter(([uid]) => groupOf.get(uid) === gi + 1).map(([, i]) => i);
      const clusters = cmp.groups
        .map((c, ci) => ({ label: c.label, count: idx.filter((i) => clusterOf.get(i) === ci).length }))
        .filter((c) => c.count > 0);
      return { group: gi + 1, respondents: idx.length, clusters, alignmentRate: alignmentRate(clusters.map((c) => ({ members: Array.from({ length: c.count }, (_, k) => k) })), idx.length) };
    });
    const summary = {
      respondents: stmts.size,
      groups: cmp.groups,
      byGroup,
      metrics: {
        reflectionRate: coverage.exists ? coverage.get('reflectionRate') : null,
        alignmentRate: alignmentRate(cmp.groups, stmts.size),
        participationFairness: participationFairness(counts),
        interventionEffectiveness: interventionEffectiveness(approved.size, new Set(cmp.addressedInsightIds).size),
      },
      source: gemini.source,
      updatedAt: FieldValue.serverTimestamp(),
    };
    await db.doc(`rooms/${roomId}/results/summary`).set(summary);
    res.json({ ...summary, updatedAt: undefined });
  })));

  app.use((_req, _res, next) => next(new HttpError(404, 'not_found', '見つかりません')));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) { res.status(err.status).json({ error: { code: err.code, message: err.message, ...err.extra } }); return; }
    console.error(err);
    res.status(500).json({ error: { code: 'internal', message: 'サーバーでエラーが起きました' } });
  });
  return app;
}
