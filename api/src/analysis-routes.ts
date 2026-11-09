import { trackJob } from './job-events.js';
import type { Express } from 'express';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { HttpError, wrap, requireOpenRoom, type Handler } from './http.js';
import { createAnalysisJobs } from './analysis-jobs.js';
import { validateComparison } from './gemini.js';
import { validateLiveOverview, type LiveOverview } from './live-overview.js';
import { groupNumber, messageCounts } from './policy.js';
import { alignmentRate, interventionEffectiveness, participationFairness, reflectionRate } from './metrics.js';
import type { Dependencies } from './dependencies.js';
export function registerAnalysisRoutes(app: Express, deps: Dependencies, guards: { authenticate: Handler; member: Handler; moderator: Handler }) {
  const { db, gemini } = deps;
  const { authenticate, member, moderator } = guards;
  const { beginAnalysis, finishAnalysis } = createAnalysisJobs(deps);
  const roomRef = (id: string) => db.doc(`sessions/${id}`);
  const chain = (...handlers: Handler[]) => handlers;
  // 未検討論点の分析（司会者）。複数インスタンスでも重複しないよう、部屋ドキュメントのトランザクションで排他する
  app.post('/rooms/:roomId/analyze', ...chain(authenticate, member, moderator, wrap(async (req, res) => {
    const roomId = req.params.roomId;
    const { jobId } = await beginAnalysis(roomId, 'analysis');
    const [ops, msgs, room, members] = await Promise.all([
      db.collection(`sessions/${roomId}/privateOpinions`).get(),
      db.collection(`sessions/${roomId}/messages`).orderBy('createdAt').get(),
      roomRef(roomId).get(),
      db.collection(`sessions/${roomId}/members`).where('role', '==', 'participant').get(),
    ]);
    const groupOf = new Map(members.docs.filter(m => m.get('status') !== 'inactive').map(m => [m.id, groupNumber(m, room.get('groups'))]));
    const groups = Array.from({ length: room.get('groups') ?? 1 }, (_, i) => ({ group: i + 1, messages: msgs.docs.filter(d => groupOf.get(d.get('uid')) === i + 1).slice(-20).map(d => String(d.get('text')).slice(0, 500)) })).filter(g => g.messages.length);
    let points;
    let overview: LiveOverview = { groups: [], suggestions: [] };
    try {
      points = await trackJob(deps, 'points', jobId, () => gemini.findPoints(ops.docs.map((d) => d.get('text')), msgs.docs.map((d) => d.get('text'))));
      if (groups.length) overview = await trackJob(deps, 'group', jobId, async () => validateLiveOverview(await gemini.summarizeGroups({ theme: room.get('theme') ?? room.get('title') ?? '', groups }), groups.map(g => g.group)));
    } catch {
      await finishAnalysis(roomId, 'analysis', jobId, (tx) => {
        tx.update(roomRef(roomId), { 'analysis.status': 'failed', 'analysis.error': 'gemini_unavailable' });
      });
      throw new HttpError(503, 'gemini_unavailable', 'AI の提案は一時停止中です。議論はそのまま続けられます');
    }
    // 分析のたびに提案が重なって増えないよう、同じトランザクションで
    // ・すでに全員に表示した・見送った提案と同じ文は出し直さない
    // ・まだ決めていない古い提案は、今回の結果に置き換える
    // を行う。その間に承認・見送りが起きたら、トランザクションごとやり直して判定し直す。
    // 遅れて返った古い結果は捨てる（jobId が今の分析と一致するときだけ保存）
    const insightsRef = db.collection(`sessions/${roomId}/insights`);
    let fresh: string[] = [];
    const saved = await finishAnalysis(roomId, 'analysis', jobId, async (tx) => {
      const existing = await tx.get(insightsRef);
      const decided = new Set(existing.docs.filter((d) => d.get('status') !== 'pending').map((d) => d.get('summary') as string));
      const candidates = [...points.filter(x => !x.discussed).map(x => ({ summary: x.summary, kind: 'missing' })), ...overview.suggestions];
      const kinds = new Map(candidates.map(c => [c.summary, c.kind]));
      fresh = [...kinds.keys()].filter(s => !decided.has(s));
      for (const d of existing.docs) if (d.get('status') === 'pending') tx.delete(d.ref);
      for (const summary of fresh) {
        tx.set(insightsRef.doc(), { summary, kind: kinds.get(summary), status: 'pending', jobId, source: gemini.source, createdAt: FieldValue.serverTimestamp() });
      }
      tx.set(db.doc(`sessions/${roomId}/results/live-groups`), { groups: overview.groups, source: gemini.source, jobId, updatedAt: FieldValue.serverTimestamp() });
      tx.set(db.doc(`sessions/${roomId}/results/coverage`), {
        total: points.length, discussed: points.filter((x) => x.discussed).length,
        // 教員の画面に「話された論点／まだの論点」を出すため、Gemini が言い換えた論点を残す（事前意見の本文は入れない。教員だけが読める）
        points: points.map((x) => ({ summary: x.summary, discussed: x.discussed })),
        reflectionRate: reflectionRate(points), source: gemini.source, jobId, updatedAt: FieldValue.serverTimestamp(),
      });
      tx.update(roomRef(roomId), { 'analysis.status': 'done', 'analysis.finishedAt': FieldValue.serverTimestamp() });
    });
    if (!saved) throw new HttpError(409, 'stale_result', '新しい分析が始まったため、この結果は破棄しました');
    res.json({ jobId, suggested: fresh.length, total: points.length });
  })));

  // 提出状況（司会者）。非公開の事前意見と合意の一文は、本文を返さず件数だけを返す
  app.post('/rooms/:roomId/progress', ...chain(authenticate, member, moderator, wrap(async (req, res) => {
    const roomId = req.params.roomId;
    const [room, members, opinions, statements] = await Promise.all([
      roomRef(roomId).get(),
      db.collection(`sessions/${roomId}/members`).where('role', '==', 'participant').get(),
      db.collection(`sessions/${roomId}/privateOpinions`).select().get(),
      db.collection(`sessions/${roomId}/consensusStatements`).select().get(),
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
    const ref = db.doc(`sessions/${req.params.roomId}/insights/${req.params.insightId}`);
    await db.runTransaction(async (tx) => {
      requireOpenRoom(await tx.get(roomRef(req.params.roomId)));
      const s = await tx.get(ref);
      if (!s.exists) throw new HttpError(404, 'insight_not_found', '提案がありません');
      if (s.get('status') !== 'pending') throw new HttpError(409, 'already_decided', 'この提案は処理済みです');
      tx.update(ref, { status: 'approved', approvedAt: FieldValue.serverTimestamp() });
    });
    res.json({ status: 'approved' });
  })));

  // 提案を見送る（司会者）。見送った提案は参加者に届かず、同じ文は次の分析でも出し直さない
  app.post('/rooms/:roomId/insights/:insightId/dismiss', ...chain(authenticate, member, moderator, wrap(async (req, res) => {
    const ref = db.doc(`sessions/${req.params.roomId}/insights/${req.params.insightId}`);
    await db.runTransaction(async (tx) => {
      requireOpenRoom(await tx.get(roomRef(req.params.roomId)));
      const s = await tx.get(ref);
      if (!s.exists) throw new HttpError(404, 'insight_not_found', '提案がありません');
      if (s.get('status') !== 'pending') throw new HttpError(409, 'already_decided', 'この提案は処理済みです');
      tx.update(ref, { status: 'dismissed', dismissedAt: FieldValue.serverTimestamp() });
    });
    res.json({ status: 'dismissed' });
  })));

  // 合意の実態検証と4つの指標（司会者）
  app.post('/rooms/:roomId/consensus/analyze', ...chain(authenticate, member, moderator, wrap(async (req, res) => {
    const roomId = req.params.roomId;
    const { jobId, groups: roomGroups } = await beginAnalysis(roomId, 'consensusAnalysis');
    const [stmts, approved, msgs, members, coverage] = await Promise.all([
      db.collection(`sessions/${roomId}/consensusStatements`).get(),
      db.collection(`sessions/${roomId}/insights`).where('status', '==', 'approved').get(),
      db.collection(`sessions/${roomId}/messages`).orderBy('createdAt').get(),
      db.collection(`sessions/${roomId}/members`).where('role', '==', 'participant').get(),
      db.doc(`sessions/${roomId}/results/coverage`).get(),
    ]);
    const firstApproval = Math.min(...approved.docs.map((d) => (d.get('approvedAt') as Timestamp | undefined)?.toMillis() ?? Infinity));
    const after = msgs.docs.filter((d) => ((d.get('createdAt') as Timestamp | undefined)?.toMillis() ?? 0) >= firstApproval).map((d) => d.get('text') as string);
    let cmp;
    try {
      cmp = await trackJob(deps, 'consensus', jobId, async () => validateComparison(await gemini.compare(stmts.docs.map((d) => d.get('text')), approved.docs.map((d) => ({ id: d.id, summary: d.get('summary') })), after), stmts.size, approved.docs.map((d) => d.id)));
    } catch {
      await finishAnalysis(roomId, 'consensusAnalysis', jobId, (tx) => {
        tx.update(roomRef(roomId), { 'consensusAnalysis.status': 'failed' });
      });
      throw new HttpError(503, 'gemini_unavailable', 'AI の分析は一時停止中です。少し待ってから再実行してください');
    }
    const counts = messageCounts(members.docs.map((m) => m.id), msgs.docs.map((d) => d.get('uid')));
    // クラス内のグループごとに、合意の一文がどのまとまりに入ったかを数える（Gemini の呼び出しは増やさない）
    const groupOf = new Map(members.docs.map((m) => [m.id, groupNumber(m, roomGroups)]));
    const clusterOf = new Map<number, number>();
    cmp.groups.forEach((g, ci) => g.members.forEach((i) => clusterOf.set(i, ci)));
    const groupCount = roomGroups ?? 1;
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
    const saved = await finishAnalysis(roomId, 'consensusAnalysis', jobId, (tx) => {
      tx.set(db.doc(`sessions/${roomId}/results/summary`), { ...summary, jobId });
      tx.update(roomRef(roomId), { 'consensusAnalysis.status': 'done', 'consensusAnalysis.finishedAt': FieldValue.serverTimestamp() });
    });
    if (!saved) throw new HttpError(409, 'stale_result', '新しい分析や状態変更のため、この結果は破棄しました');
    res.json({ ...summary, updatedAt: undefined });
  })));

}
