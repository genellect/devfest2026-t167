import { createSerialQueue } from './serial-queue.js';
import { trackJob } from './job-events.js';
import { randomUUID } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { HttpError, requireOpenRoom } from './http.js';
import { ANALYZE_COOLDOWN_MS, RUNNING_TIMEOUT_MS, statusOf, nextGroupState } from './policy.js';
import { groupMembers, groupDocuments } from './group-data.js';
import { validateComparison } from './gemini.js';
import { alignmentRate } from './metrics.js';
import type { Dependencies } from './dependencies.js';
export function createGroupService(deps: Dependencies) {
  const { db, gemini, now } = deps;
  const serialize = createSerialQueue();
  const roomRef = (id: string) => db.doc(`rooms/${id}`);
  /** 人数・提出数と状態を同じトランザクションで読み、開始・参加・終了との競合を再検査する。 */
  async function refreshGroup(roomId: string, group: number, opts: { forceStart?: boolean } = {}) {
    const state = await serialize(roomId, () => db.runTransaction(async (tx) => {
      const room = await tx.get(roomRef(roomId));
      requireOpenRoom(room);
      const members = await groupMembers(tx, room, group);
      const uids = new Set(members.map((member) => member.id));
      const [ops, stmts] = await Promise.all([
        groupDocuments(tx, room, 'privateOpinions', [...uids], true),
        groupDocuments(tx, room, 'consensusStatements', [...uids], true),
      ]);
      const opinions = ops.length, submitted = stmts.length;
      const status = statusOf(room, group);
      const started = nextGroupState(status, uids.size, opinions, opts.forceStart) !== status;
      const previous = room.get('groupState')?.[group] ?? {};
      if (started || previous.total !== uids.size || previous.opinions !== opinions || previous.submitted !== submitted) {
        tx.set(room.ref, { groupState: { [group]: {
        total: uids.size, opinions, submitted,
        ...(started ? { status: 'discussing', startedAt: FieldValue.serverTimestamp() } : {}),
        } } }, { merge: true });
      }
      return { total: uids.size, opinions, submitted, started, status };
    }));
    if (state.status === 'consensus' && state.total > 0 && state.submitted >= state.total) return analyzeGroup(roomId, group);
    return { total: state.total, opinions: state.opinions, submitted: state.submitted, started: state.started };
  }

  /**
   * そのグループの一文を分析して results/group-{番号} に保存する。Gemini の呼び出しを増やしすぎないよう、
   * - 結果が出た（done）グループは、先生の出し直し（force）でなければ分析し直さない
   * - 分析はグループごとに同時に1つだけ。始めるときに jobId を書き、保存するときに一致を確かめて古い結果を捨てる
   * - 出し直しは、前の分析の開始から30秒あける（manual なら 429、自動なら何もしない）
   */
  async function analyzeGroup(roomId: string, group: number, opts: { force?: boolean; manual?: boolean } = {}) {
    const jobId = randomUUID();
    const claim = await db.runTransaction(async (tx) => {
      const room = await tx.get(roomRef(roomId));
      requireOpenRoom(room);
      const members = await groupMembers(tx, room, group);
      const uids = new Set(members.map((member) => member.id));
      const stmts = await groupDocuments(tx, room, 'consensusStatements', [...uids]);
      const ready = uids.size > 0 && stmts.length >= uids.size;
      const base = { ready, analyzed: false, submitted: stmts.length, total: uids.size };
      const st = room.get('groupState')?.[group] ?? {};
      const a = st.analysis ?? {};
      const started = a.startedAt instanceof Timestamp ? a.startedAt.toMillis() : 0;
      const wait = ANALYZE_COOLDOWN_MS - (now() - started);
      const skip = ((!ready && !opts.force) || !stmts.length) ? 'not_ready'
        : st.status === 'done' && !opts.force ? 'done'
        : a.running && now() - started < RUNNING_TIMEOUT_MS ? 'running'
        : wait > 0 ? 'cooldown' : undefined;
      tx.set(room.ref, { groupState: { [group]: {
        submitted: stmts.length, total: uids.size,
        ...(!skip ? { analysis: { jobId, running: true, startedAt: Timestamp.fromMillis(now()) } } : {}),
      } } }, { merge: true });
      return { skip, wait, base, stmts };
    });
    const { base, stmts } = claim;
    if (claim.skip === 'not_ready') return base;
    if (claim.skip === 'cooldown' && opts.manual) {
      const sec = Math.ceil((claim.wait ?? 0) / 1000);
      throw new HttpError(429, 'cooldown', `あと ${sec} 秒待ってください`, { retryAfterSec: sec });
    }
    if (claim.skip) return { ...base, skipped: claim.skip };
    // 保存や後片付けは、今の分析（jobId が一致）のときだけ行う
    const finishIfMine = (write: (tx: FirebaseFirestore.Transaction) => void) => db.runTransaction(async (tx) => {
      const room = await tx.get(roomRef(roomId));
      const st = room.get('groupState')?.[group] ?? {};
      if (room.get('phase') === 'closed' || st.analysis?.jobId !== jobId) return false;
      write(tx);
      return true;
    });
    let cmp;
    try {
      cmp = await trackJob(deps, 'group', jobId, async () => validateComparison(await gemini.compare(stmts.map((d) => d.get('text') as string), [], []), stmts.length, []));
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

  return { refreshGroup, analyzeGroup };
}
