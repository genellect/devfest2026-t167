import { roomTransaction } from './room-transaction.js';
import { FieldValue } from 'firebase-admin/firestore';
import type { Dependencies } from './dependencies.js';
/** 既存のグループ分析を集計する。追加のAI呼び出しや未分析グループの推測は行わない。 */
export async function updateDiscussionSummary(deps: Dependencies, roomId: string) {
  const ref = deps.db.doc(`sessions/${roomId}`);
  await roomTransaction(deps.db,roomId,async (tx) => {
    const room = await tx.get(ref);
    if (room.get('flowVersion') !== 1) return;
    const results = await tx.get(ref.collection('results'));
    const flows = results.docs.filter((d) => /^flow-g\d+$/.test(d.id));
    tx.set(ref.collection('results').doc('session-summary'), {
      kind: 'group-aggregate', totalGroups: room.get('groups'), analyzedGroups: flows.length,
      totalMinutes: flows.reduce((n, d) => n + (d.get('totalMinutes') ?? 0), 0),
      good: flows.flatMap((d) => (d.get('good') ?? []).map((p: { text: string }) => ({ group: d.get('group'), text: p.text }))),
      review: flows.flatMap((d) => (d.get('review') ?? []).map((p: { text: string }) => ({ group: d.get('group'), text: p.text }))),
      source: deps.gemini.source, updatedAt: FieldValue.serverTimestamp(),
    });
  });
}
