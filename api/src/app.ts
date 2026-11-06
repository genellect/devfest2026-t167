import express, { type NextFunction, type Request, type Response } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { HttpError, wrap, run, parse, requireOpenRoom, requireModerator } from './http.js';
import { participantGroup } from './membership.js';
import { registerLiveRoutes } from './live-routes.js';
import { sessionGuards, registerSessionRoutes } from './session-routes.js';
import { createLimiter } from './limits.js';
import { PHASES, MAX_GROUPS, statusOf, canSubmitStatement, statementLocked } from './policy.js';
import { createGroupService } from './groups.js';
import { registerRecordingRoutes } from './recording-routes.js';
import { registerAnalysisRoutes } from './analysis-routes.js';
import type { Dependencies } from './dependencies.js';
export { PHASES, ANALYZE_COOLDOWN_MS, MAX_GROUPS, MAX_RECORDING_SEC, MAX_RECORDING_BYTES, MAX_RECORDING_ATTEMPTS } from './policy.js';
export type { OperationEvent } from './dependencies.js';

export function createApp(deps: Omit<Dependencies, 'now'> & { now?: () => number }) {
  const { db, gemini } = deps;
  const now = deps.now ?? Date.now;
  const runtime = { ...deps, now };
  const { refreshGroup, analyzeGroup } = createGroupService(runtime);
  const app = express();

  const limit = createLimiter(db, now);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const requestId = randomUUID(), started = performance.now();
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.on('finish', () => {
      // route は定義済みテンプレートだけ。URL・本文・認証情報・利用者IDを記録しない。
      try { deps.observe?.({ requestId, route: req.route?.path ?? 'unmatched', status: res.statusCode, durationMs: Math.round(performance.now() - started), ...(res.locals.errorCode ? { code: res.locals.errorCode } : {}) }); } catch { /* 計測の失敗でAPIを壊さない */ }
    });
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  app.param(['roomId', 'insightId'], (_req, _res, next, value: string) => {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) { next(new HttpError(400, 'bad_request', '識別子を確認してください')); return; }
    next();
  });
  const guards = sessionGuards(runtime);
  const authenticate = run(async (req, res) => {
    await new Promise<void>((resolve, reject) => guards.authenticate(req, res, (e?: unknown) => e ? reject(e) : resolve()));
    if (req.params.roomId) await limit(req.ctx.uid, 'submit', 120);
  });
  registerSessionRoutes(app, runtime, guards, limit);
  const chain = (...fns: ((req: Request, res: Response, next: NextFunction) => void)[]) => fns;
  // 所属確認：パスの roomId のメンバーか
  const member = run(async (req) => {
    const snap = await db.doc(`rooms/${req.params.roomId}/members/${req.ctx.uid}`).get();
    if (!snap.exists) throw new HttpError(403, 'not_member', 'この部屋のメンバーではありません');
    req.ctx.role = snap.get('role');
  });
  // 司会者確認
  const moderator = run(async (req) => {
    requireModerator(req.ctx);
  });
  registerLiveRoutes(app, runtime, guards, member);
  const roomRef = (id: string) => db.doc(`rooms/${id}`);
  // 稼働確認。Cloud Run は z で終わるパス（/healthz など）を予約していてコンテナに届かないので、/health を使う。
  // /healthz は手元と古い手順のために残す
  app.get(['/health', '/healthz'], (_req, res) => { res.json({ ok: true, gemini: gemini.source }); });

  // 部屋の作成：管理側で教師権限を付けたGoogleログインが必要。所属はまだないので所属確認はしない
  app.post('/rooms', ...chain(authenticate, wrap(async (req, res) => {
    if (!req.ctx.teacher) throw new HttpError(403, 'teacher_required', '管理者が承認した先生だけが部屋を作成できます');
    await limit(req.ctx.uid, 'create', 10, 60 * 60_000);
    // recording：グループの議論を録音して分析するか（録音の権限は先生が持つ。既定は録音する）
    const { title, groups, recording } = parse(z.object({
      title: z.string().trim().min(1).max(100), groups: z.number().int().min(1).max(MAX_GROUPS).default(1), recording: z.boolean().default(true),
    }), req.body);
    const roomId = db.collection('rooms').doc().id;
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let attempt = 0; attempt < 5; attempt++) {
      const joinCode = Array.from(randomBytes(6), (b) => alphabet[b % alphabet.length]).join('');
      const ok = await db.runTransaction(async (tx) => {
        const codeRef = db.doc(`joinCodes/${joinCode}`);
        if ((await tx.get(codeRef)).exists) return false;
        tx.set(codeRef, { roomId });
        tx.set(roomRef(roomId), { schemaVersion: 2, title, groups, recording, phase: 'collecting', joinCode, createdBy: req.ctx.uid, createdAt: FieldValue.serverTimestamp(), analysis: { status: 'idle' } });
        tx.set(db.doc(`rooms/${roomId}/members/${req.ctx.uid}`), { role: 'moderator', joinedAt: FieldValue.serverTimestamp() });
        return true;
      });
      if (ok) { res.status(201).json({ roomId, joinCode }); return; }
    }
    throw new HttpError(503, 'join_code_exhausted', '参加コードを作れませんでした。もう一度試してください');
  })));

  // 参加：参加前なので所属確認はしない。参加コードで部屋を特定し、participant として登録する
  app.post('/rooms/join', ...chain(authenticate, wrap(async (req, res) => {
    await limit(req.ctx.uid, 'join', 30);
    const { code } = parse(z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6}$/, '参加コードは6文字です') }), req.body);
    const codeSnap = await db.doc(`joinCodes/${code}`).get();
    if (!codeSnap.exists) throw new HttpError(404, 'join_code_not_found', '参加コードが見つかりません');
    const roomId = codeSnap.get('roomId') as string;
    const joinedSingleGroup = await db.runTransaction(async (tx) => {
      const room = await tx.get(roomRef(roomId));
      requireOpenRoom(room);
      const mRef = db.doc(`rooms/${roomId}/members/${req.ctx.uid}`);
      if (!(await tx.get(mRef)).exists) {
        const singleGroup = (room.get('groups') ?? 1) <= 1;
        if (singleGroup && statusOf(room, 1) !== 'opinions') throw new HttpError(409, 'group_started', 'このグループはもう議論を始めています');
        // グループが1つなら自動でグループ1。複数なら、参加のあとに生徒が自分で選ぶ（groups/choose）
        tx.set(mRef, { role: 'participant', ...(singleGroup ? { group: 1 } : {}), joinedAt: FieldValue.serverTimestamp() });
        return singleGroup;
      }
      return false;
    });
    if (joinedSingleGroup) await refreshGroup(roomId, 1);
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

  // ---- グループごとの進行 ----
  // グループはそれぞれのペースで進む。先生が一斉に開くことはしない。
  //   opinions（メンバー集め・事前意見）→ 全員の事前意見がそろう → discussing（議論）
  //   → 生徒のだれかが終える → consensus（結論の一文）→ 全員の一文がそろう → done（結果）
  // 状態と人数は部屋ドキュメントの groupState.{番号} = { status, total, opinions, submitted } に入る（本文は含めない）
  const participantOnly = run(async (req) => {
    if (req.ctx.role !== 'participant') throw new HttpError(403, 'participant_only', '生徒だけが実行できます');
  });


  // グループを選ぶ（生徒）。議論を始めたグループには入れない。自分のグループが始まったあとは移れない
  app.post('/rooms/:roomId/groups/choose', ...chain(authenticate, member, participantOnly, wrap(async (req, res) => {
    const roomId = req.params.roomId;
    const { group } = parse(z.object({ group: z.number().int().min(1).max(MAX_GROUPS) }), req.body);
    const prev = await db.runTransaction(async (tx) => {
      const room = await tx.get(roomRef(roomId));
      requireOpenRoom(room);
      if (group > (room.get('groups') ?? 1)) throw new HttpError(400, 'bad_request', 'グループ番号を確認してください');
      const previous = await participantGroup(tx, room, req.ctx.uid).catch((error: unknown) => {
        if (error instanceof HttpError && error.code === 'no_group') return undefined;
        throw error;
      });
      if (previous === group) return previous;
      if (statusOf(room, group) !== 'opinions' || (previous && statusOf(room, previous) !== 'opinions'))
        throw new HttpError(409, 'group_started', '議論を始めたグループには移動できません');
      tx.update(db.doc(`rooms/${roomId}/members/${req.ctx.uid}`), { group });
      return previous;
    });
    if (prev) await refreshGroup(roomId, prev);
    await refreshGroup(roomId, group);
    res.json({ group });
  })));

  // 事前の意見を出す（生徒）。グループ全員がそろうと、そのグループの議論が始まる
  app.post('/rooms/:roomId/opinion', ...chain(authenticate, member, participantOnly, wrap(async (req, res) => {
    const roomId = req.params.roomId;
    const { text } = parse(z.object({ text: z.string().trim().min(1).max(1000) }), req.body);
    const group = await db.runTransaction(async (tx) => {
      const room = await tx.get(roomRef(roomId));
      requireOpenRoom(room);
      const group = await participantGroup(tx, room, req.ctx.uid);
      if (statusOf(room, group) !== 'opinions') throw new HttpError(409, 'wrong_phase', 'グループの議論が始まったので、事前の意見は変えられません');
      tx.set(db.doc(`rooms/${roomId}/privateOpinions/${req.ctx.uid}`), { text, updatedAt: FieldValue.serverTimestamp() });
      return group;
    });
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
    const group = await db.runTransaction(async (tx) => {
      const room = await tx.get(roomRef(roomId));
      requireOpenRoom(room);
      const group = await participantGroup(tx, room, req.ctx.uid);
      const status = statusOf(room, group);
      if (status === 'consensus' || status === 'done') return group;
      if (status !== 'discussing') throw new HttpError(409, 'wrong_phase', 'グループの議論がまだ始まっていません');
      tx.set(room.ref, { groupState: { [group]: { status: 'consensus', endedAt: FieldValue.serverTimestamp() } } }, { merge: true });
      return group;
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
    const group = await db.runTransaction(async (tx) => {
      const room = await tx.get(roomRef(roomId));
      requireOpenRoom(room);
      const group = await participantGroup(tx, room, req.ctx.uid);
      const status = statusOf(room, group);
      if (statementLocked(room, group)) throw new HttpError(409, 'analysis_in_progress', '分析中または結果確定後の回答は変更できません');
      if (!canSubmitStatement(room.get('phase'), status))
        throw new HttpError(409, 'wrong_phase', 'グループの議論が終わってから書いてください');
      tx.set(db.doc(`rooms/${roomId}/consensusStatements/${req.ctx.uid}`), {
        text: body.text, agreement: body.agreement, ...(body.concern ? { concern: body.concern } : {}), updatedAt: FieldValue.serverTimestamp(),
      });
      return group;
    });
    res.json({ group, ...(await analyzeGroup(roomId, group)) });
  })));

  // グループの議論の録音を送り、Gemini で文字起こしと分析をする（生徒。チームドキュメント「仕様」F03・F04）。
  // 1グループ1台が前提なので、分析はグループに1回。音声は分析に使うだけで保存しない（結果だけを results/flow-g{番号} に書く）。
  // 録音への同意（consent=1）がない送信は受け付けない。分析に失敗したら、同じ録音を送り直せる
  registerRecordingRoutes(app, runtime, { authenticate, member, participantOnly });

  // グループの結果を出し直す。生徒は自分のグループ（全員そろっているときだけ）、先生は任意のグループを今ある回答で出せる
  app.post('/rooms/:roomId/groups/analyze', ...chain(authenticate, member, wrap(async (req, res) => {
    const roomId = req.params.roomId;
    const isMod = req.ctx.role === 'moderator';
    if (isMod) requireModerator(req.ctx);
    const group = await db.runTransaction(async (tx) => {
      const room = await tx.get(roomRef(roomId));
      requireOpenRoom(room);
      return isMod
        ? parse(z.object({ group: z.number().int().min(1).max(room.get('groups') ?? 1) }), req.body).group
        : participantGroup(tx, room, req.ctx.uid);
    });
    // 生徒は全員そろったときだけ、先生は今ある回答でも出せる。どちらも30秒あける
    const r = await analyzeGroup(roomId, group, { force: isMod, manual: true });
    if ('error' in r) throw new HttpError(503, 'gemini_unavailable', 'AI の分析は一時停止中です。少し待ってから再実行してください');
    res.json({ group, ...r });
  })));

  registerAnalysisRoutes(app, runtime, { authenticate, member, moderator });

  app.use((_req, _res, next) => next(new HttpError(404, 'not_found', '見つかりません')));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) { res.locals.errorCode = err.code; if ('retryAfterSec' in err.extra) res.setHeader('Retry-After', String(err.extra.retryAfterSec)); res.status(err.status).json({ error: { code: err.code, message: err.message, ...err.extra } }); return; }
    // 本文の読み取りの失敗（express.json・express.raw）は、利用者に分かる 4xx で返す
    const type = (err as { type?: string })?.type;
    if (type === 'entity.too.large') { res.status(413).json({ error: { code: 'too_large', message: '送った内容が大きすぎます（録音は12MB・30分まで）' } }); return; }
    if (type === 'entity.parse.failed') { res.status(400).json({ error: { code: 'bad_request', message: '送った内容を読み取れません' } }); return; }
    console.error('api_internal_error');
    res.status(500).json({ error: { code: 'internal', message: 'サーバーでエラーが起きました' } });
  });
  return app;
}
