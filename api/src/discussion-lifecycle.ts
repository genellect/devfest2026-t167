import { roomTransaction } from './room-transaction.js';
import { updateDiscussionSummary } from './discussion-results.js';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import type { Dependencies } from './dependencies.js';
import { HttpError } from './http.js';
/** 終了時刻はサーバーで判定。終了後は音声の送信・分析を5分間だけ受け付ける。 */
export async function endDiscussion(deps: Dependencies, roomId: string, reason: 'host' | 'timeout', forced = false) {
  const ref = deps.db.doc(`sessions/${roomId}`);
  await roomTransaction(deps.db,roomId,async (tx) => {
    const room = await tx.get(ref);
    if (!room.exists || room.get('endedAt') || room.get('phase') === 'closed') return;
    if (!forced && (room.get('phase') !== 'discussing' || !(room.get('endsAt') instanceof Timestamp) || room.get('endsAt').toMillis() > deps.now())) return;
    if (room.get('flowVersion') !== 1) return;
    const state: Record<string, unknown> = {};
    for (let g = 1; g <= room.get('groups'); g++) state[g] = { ...(room.get('groupState')?.[g] ?? {}), status: 'consensus' };
    const endedAt = reason === 'timeout'
      ? Timestamp.fromMillis(Math.min(room.get('endsAt')?.toMillis() ?? Infinity, room.get('expiresAt')?.toMillis() ?? deps.now()))
      : Timestamp.fromMillis(deps.now());
    tx.update(ref, { phase: 'consensus', endedAt, voiceCleanupPending: true, endReason: reason, groupState: state, resultsPublished: room.get('publishOnEnd') === true, updatedAt: FieldValue.serverTimestamp() });
  });
  const ended = await ref.get();
  if (ended.get('endedAt')) {
    await updateDiscussionSummary(deps, roomId);
    const temporary = await ref.collection('voiceProfiles').get();
    for (let i = 0; i < temporary.size; i += 400) {
      const batch = deps.db.batch(); temporary.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref)); await batch.commit();
    }
    await ref.update({ voiceCleanupPending: false });
  }
}
export async function enforceDiscussionTime(deps: Dependencies, roomId: string) {
  const ref = deps.db.doc(`sessions/${roomId}`), room = await ref.get();
  if (room.get('flowVersion') !== 1) return;
  if (room.get('voiceCleanupPending')) { await endDiscussion(deps, roomId, 'timeout'); return; }
  if (!room.get('endedAt') && room.get('expiresAt') instanceof Timestamp && room.get('expiresAt').toMillis() <= deps.now()) {
    await endDiscussion(deps, roomId, 'timeout', true); return;
  }
  if (!room.get('endedAt') && room.get('endsAt') instanceof Timestamp && room.get('endsAt').toMillis() <= deps.now()) await endDiscussion(deps, roomId, 'timeout');
}
export function requireDiscussionActive(room: FirebaseFirestore.DocumentSnapshot) {
  if (room.get('flowVersion') === 1 && room.get('endedAt')) throw new HttpError(409, 'discussion_ended', 'ディスカッションは終了しました');
}
