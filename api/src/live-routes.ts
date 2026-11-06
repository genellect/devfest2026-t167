import type { Express } from 'express';
import type { DocumentData, DocumentReference, Query, DocumentSnapshot, QuerySnapshot } from 'firebase-admin/firestore';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { enforceDiscussionTime } from './discussion-lifecycle.js';
import { SESSION_CHECK_MS } from './session-policy.js';
import { readSessionCookie, type sessionGuards } from './session-routes.js';
import { HttpError, parse, run, wrap, type Handler } from './http.js';
import type { Dependencies } from './dependencies.js';

/** JSONを越える時刻は専用の値で渡し、画面側でtoMillisだけを復元する。 */
export function wireData(value: unknown): unknown {
  if (value instanceof Timestamp) return { __time: value.toMillis() };
  if (Array.isArray(value)) return value.map(wireData);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, wireData(v)]));
  return value;
}
export function mayReadResult(id: string, moderator: boolean, group: number, published = false) {
  return moderator || (published && group >= 1 && (id === `group-${group}` || id === `flow-g${group}`));
}
export function registerLiveRoutes(app: Express, deps: Dependencies, guards: ReturnType<typeof sessionGuards>, member: Handler) {
  const { db, auth } = deps;
  app.get('/rooms/:roomId/me', guards.authenticate, member, wrap(async (req, res) => {
    const snap = await db.doc(`sessions/${req.params.roomId}/members/${req.ctx.uid}`).get();
    res.json({ uid: req.ctx.uid, role: snap.get('role'), groupId: snap.get('groupId') ?? null, status: snap.get('status') ?? 'active', group: snap.get('group') ?? null });
  }));
  // 以前直接Firestoreへ書けた発言も、同じセッション/所属/フェーズ検査へ統一する。
  app.post('/rooms/:roomId/messages', guards.authenticate, member, wrap(async (req, res) => {
    const { text } = parse(z.object({ text: z.string().trim().min(1).max(500) }).strict(), req.body);
    await db.runTransaction(async (tx) => {
      const room = await tx.get(db.doc(`sessions/${req.params.roomId}`));
      if (room.get('phase') !== 'discussing' || room.get('endedAt')) throw new HttpError(409, 'wrong_phase', '議論中だけ送信できます');
      tx.create(db.collection(`sessions/${req.params.roomId}/messages`).doc(), { uid: req.ctx.uid, text, createdAt: FieldValue.serverTimestamp() });
    });
    res.json({ ok: true });
  }));
  app.get('/rooms/:roomId/live', guards.authenticate, member, run(async (req, res) => {
    const roomPath = `sessions/${req.params.roomId}`, uid = req.ctx.uid, token = req.ctx.token!;
    const membership = await db.doc(`${roomPath}/members/${uid}`).get();
    const role = membership.get('role'), group = membership.get('group') ?? 0;
    const moderator = role === 'host';
    const secret = readSessionCookie(req), rawToken = req.header('authorization')!.slice(7);
    res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Content-Encoding', 'identity'); // Next.jsの圧縮バッファで小さいイベントが滞留しないようにする。
    res.setHeader('Cache-Control', 'no-store, no-transform'); res.flushHeaders();
    let closed = false, checking = false;
    const subscriptions: (() => void)[] = [];
    const close = () => { if (closed) return; closed = true; clearInterval(timer); subscriptions.forEach((off) => off()); res.end(); };
    const fail = (error: unknown) => {
      if (!closed) res.write(`event: failure\ndata: ${JSON.stringify({ code: error instanceof HttpError ? error.code : 'stream_unavailable', ...(error instanceof HttpError ? error.extra : {}) })}\n\n`);
      close();
    };
    async function check() {
      await guards.sessions.validate(token, secret);
      await enforceDiscussionTime(deps, req.params.roomId);
      const current = await db.doc(`${roomPath}/members/${uid}`).get();
      if (!current.exists || current.get('status') === 'inactive') throw new HttpError(403, 'not_member', 'この部屋のメンバーではありません');
      if (current.get('role') !== role || (current.get('group') ?? 0) !== group) { close(); return false; }
      return true;
    }
    // イベント配信は直列化し、権限/失効を確認してから必要な文書だけ送る。
    let queue = Promise.resolve();
    const enqueue = (payload: { docs?: Record<string, unknown>; collections?: Record<string, unknown[]> }) => {
      queue = queue.then(async () => {
        if (closed || !(await check())) return;
        if (!moderator) {
          const room = await db.doc(roomPath).get();
          if (payload.docs) {
            for (const path of Object.keys(payload.docs)) {
              if (path.includes('/speaking/') && (room.get('participantView.speaking') !== true || (room.get('endedAt') && room.get('resultsPublished') !== true))) payload.docs[path] = null;
              if (path.includes('/results/') && !mayReadResult(path.split('/').at(-1)!, false, group, room.get('resultsPublished') === true)) payload.docs[path] = null;
              if (path === roomPath) {
                const data = { ...(room.data() ?? {}) };
                data.groupState = group ? { [group]: data.groupState?.[group] ?? {} } : {};
                delete data.analysis;
                if (data.participantView?.theme === false) data.theme = '';
                if (data.participantView?.timer === false) { delete data.endsAt; delete data.minutes; }
                payload.docs[path] = data;
              }
            }
          }
          if (payload.collections) {
            const peers = await db.collection(`${roomPath}/members`).where('group', '==', group).get();
            const ids = new Set(peers.docs.filter((m) => m.get('status') !== 'inactive').map((m) => m.id));
            for (const [path, values] of Object.entries(payload.collections)) {
              const rows = values as Record<string, unknown>[];
              if (path.endsWith('/members')) payload.collections[path] = rows.filter((r) => r.id === uid || (room.get('participantView.members') !== false && group > 0 && r.group === group));
              if (path.endsWith('/messages')) payload.collections[path] = rows.filter((r) => group > 0 && ids.has(r.uid as string));
              if (path.endsWith('/insights')) payload.collections[path] = rows.filter((r) => r.status === 'approved' && r.group === group);
            }
          }
        }
        if (!res.write(`data: ${JSON.stringify(wireData(payload))}\n\n`)) close();
      }).catch(fail);
    };
    const listenDoc = (path: string) => subscriptions.push(db.doc(path).onSnapshot((snap: DocumentSnapshot) => enqueue({ docs: { [path]: snap.exists ? snap.data() : null } }), fail));
    const listenCollection = (name: string, ref: Query<DocumentData> | DocumentReference<DocumentData>, filter?: (id: string) => boolean) => {
      subscriptions.push((ref as Query<DocumentData>).onSnapshot((snap: QuerySnapshot) => enqueue({ collections: { [name]: snap.docs.filter((d) => !filter || filter(d.id)).map((d) => ({ ...d.data(), id: d.id })) } }), fail));
    };
    const timer = setInterval(() => {
      if (checking || closed) return; checking = true;
      void auth.verifyIdToken(rawToken, true).then(() => check()).then((ok) => { if (ok && !closed) res.write(': keepalive\n\n'); }).catch((e: unknown) => fail(e instanceof HttpError ? e : new HttpError(401, 'unauthenticated', 'ログインし直してください'))).finally(() => { checking = false; });
    }, SESSION_CHECK_MS);
    // 接続終了で課金対象の購読をすべて解除する。画面の自動取得はactivityに数えない。
    res.on('close', close);
    listenDoc(roomPath);
    listenDoc(`${roomPath}/members/${uid}`);
    listenCollection(`${roomPath}/members`, db.collection(`${roomPath}/members`));
    listenCollection(`${roomPath}/messages`, db.collection(`${roomPath}/messages`).orderBy('createdAt').limitToLast(500));
    listenCollection(`${roomPath}/insights`, moderator ? db.collection(`${roomPath}/insights`) : db.collection(`${roomPath}/insights`).where('status', '==', 'approved'));
    if (moderator) listenCollection(`${roomPath}/results`, db.collection(`${roomPath}/results`), (id) => mayReadResult(id, true, group));
    else if (group >= 1) {
      const publishResults = async () => {
        const [ownResult, flow] = await db.getAll(db.doc(`${roomPath}/results/group-${group}`), db.doc(`${roomPath}/results/flow-g${group}`));
        enqueue({ docs: { [ownResult.ref.path]: ownResult.data() ?? null, [flow.ref.path]: flow.data() ?? null } });
      };
      subscriptions.push(db.doc(roomPath).onSnapshot(() => { void publishResults().catch(fail); }, fail));
      listenDoc(`${roomPath}/results/group-${group}`); listenDoc(`${roomPath}/results/flow-g${group}`);
    }
    if (group >= 1) listenDoc(`${roomPath}/groups/${group}`);
    if (moderator) {
      listenCollection(`${roomPath}/groups`, db.collection(`${roomPath}/groups`));
      listenCollection(`${roomPath}/speaking`, db.collection(`${roomPath}/speaking`));
    } else if (group >= 1) {
      listenDoc(`${roomPath}/speaking/${group}`);
      subscriptions.push(db.doc(roomPath).onSnapshot(() => {
        void db.doc(`${roomPath}/speaking/${group}`).get().then((s) => enqueue({ docs: { [s.ref.path]: s.data() ?? null } })).catch(fail);
      }, fail));
    }
    if (role === 'participant') {
      listenDoc(`${roomPath}/privateOpinions/${uid}`); listenDoc(`${roomPath}/consensusStatements/${uid}`);
    }
  }));
}
