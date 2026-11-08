import { createHash } from 'node:crypto';
import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import type { Dependencies } from './dependencies.js';
import { enforceDiscussionTime } from './discussion-lifecycle.js';
import { createProcessing } from './processing.js';
import { RETENTION } from './processing-types.js';

/** collectionGroupを使わず、渡されたDB名前空間内だけを巡回する。 */
export function createMaintenance(deps: Dependencies) {
  let roomCursor = '', userCursor = '', running = false;
  const jobs = createProcessing(deps);
  async function tick() {
    if (running) return; running = true;
    let removed = 0, processed = 0;
    try {
      let query = deps.db.collection('sessions').orderBy(FieldPath.documentId()).limit(20);
      if (roomCursor) query = query.startAfter(roomCursor);
      const rooms = await query.get(); roomCursor = rooms.size === 20 ? rooms.docs.at(-1)!.id : '';
      for (const room of rooms.docs) {
        // 削除対象を新フローと明示的に期限を持つデータに限定し、旧形式データは保持する。
        if (room.get('flowVersion') !== 1 && !room.get('retentionUntil')) continue;
        const retention = room.get('retentionUntil')?.toMillis?.() ?? ((room.get('endedAt')??room.get('createdAt'))?.toMillis?.() ?? deps.now()) + RETENTION.discussionMs;
        if (room.get('deleting') || retention <= deps.now()) { await deleteDiscussion(deps,room.id); removed++; continue; }
        await enforceDiscussionTime(deps,room.id);
        processed += (await jobs.run(room.id,2)).processed;
        if (room.get('endedAt')) {
          const sources=await room.ref.collection('transcriptionSources').get();
          const revision=createHash('sha256').update(JSON.stringify(sources.docs.map(d=>[d.id,d.get('sequence')]).sort())).digest('hex');
          if(sources.empty || room.get('finalProcessingRevision')===revision)continue;
          const members = await room.ref.collection('members').where('role','==','participant').get();
          for (const m of members.docs.filter(m=>m.get('status')==='active')) await jobs.enqueue(room.id,'participant',m.get('group')??0,m.id);
          await jobs.enqueue(room.id,'session');
          for (const group of new Set(members.docs.filter(m=>m.get('status')==='active').map(m=>m.get('group')).filter(Boolean))) await jobs.enqueue(room.id,'group',group);
          await room.ref.update({finalProcessingRevision:revision});
        }
      }
      let usersQuery = deps.db.collection('users').orderBy(FieldPath.documentId()).limit(20);
      if (userCursor) usersQuery = usersQuery.startAfter(userCursor);
      const users = await usersQuery.get(); userCursor = users.size === 20 ? users.docs.at(-1)!.id : '';
      for (const user of users.docs) {
        const expired = await user.ref.collection('sessions').where('deleteAt','<=',Timestamp.fromMillis(deps.now())).limit(100).get();
        for (const s of expired.docs) { await s.ref.delete(); removed++; }
        const profile = await user.ref.collection('voiceProfiles').doc('default').get();
        const used = profile.get('lastUsedAt')??profile.get('updatedAt');
        if (profile.exists && used?.toMillis?.() < deps.now()-RETENTION.voiceMs) { await profile.ref.delete(); removed++; }
      }
      const audits = await deps.db.collection('securityEvents').where('deleteAt','<=',Timestamp.fromMillis(deps.now())).limit(100).get();
      for (const event of audits.docs) { await event.ref.delete(); removed++; }
      return {removed,processed};
    } finally { running = false; }
  }
  function start(intervalMs = 10000) {
    const run = () => { void tick().catch(()=>{}); }; const timer = setInterval(run,intervalMs); timer.unref(); run(); return ()=>clearInterval(timer);
  }
  return {tick,start};
}
export async function deleteDiscussion(deps: Dependencies, roomId: string) {
  const ref = deps.db.doc(`sessions/${roomId}`), room = await ref.get(); if (!room.exists) return;
  await ref.update({deleting:true,phase:'closed'});
  const members = await ref.collection('members').get();
  for (const member of members.docs) await deps.db.doc(`users/${member.id}/discussions/${roomId}`).delete();
  const code = room.get('joinCode');
  if (typeof code === 'string' && /^[A-Z0-9]{6}$/.test(code)) await deps.db.runTransaction(async tx=>{const r=deps.db.doc(`joinCodes/${code}`),s=await tx.get(r);if(s.get('roomId')===roomId)tx.delete(r);});
  await deps.db.recursiveDelete(ref);
}
