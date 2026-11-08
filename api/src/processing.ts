import { roomTransaction } from './room-transaction.js';
import { createHash, randomUUID } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Dependencies } from './dependencies.js';
import type { Evidence } from './processing-types.js';
import { RETENTION } from './processing-types.js';
import { HttpError } from './http.js';
import { participationFairness } from './metrics.js';

interface Job { count: number; head: string; kind: Kind; group: number; uid: string; evidence: Evidence[]; lease: string }
type Kind = 'insights' | 'participant' | 'session' | 'group';
/** 原音を保存せず、再実行可能な分析入力だけを非公開ジョブへ保持する。leaseとjobIdで重複保存を防ぐ。 */
export function createProcessing(deps: Dependencies) {
  const roomRef = (id: string) => deps.db.doc(`sessions/${id}`);
  async function enqueue(roomId: string, kind: Kind, group = 0, uid = '') {
    const source = await roomRef(roomId).collection('transcripts').get();
    const evidence = source.docs.filter(d => (!group || d.get('group') === group) && (!uid || d.get('ownerUid') === uid)).sort((a,b) => a.get('startMs') - b.get('startMs')).slice(-200).map(d => ({ id: d.id, text: d.get('text') as string }));
    const id = createHash('sha256').update(JSON.stringify({kind,group,uid,evidence})).digest('hex');
    const ref = roomRef(roomId).collection('processingJobs').doc(id);
    const head = `${kind}-${group}-${uid||'all'}`, headRef = roomRef(roomId).collection('processingHeads').doc(head);
    await roomTransaction(deps.db,roomId,async tx => {
      const room = await tx.get(roomRef(roomId));
      const [current, previous] = await tx.getAll(ref, headRef);
      if (!room.exists || room.get('deleting')) throw new HttpError(404,'room_not_found','セッションがありません');
      if (current.exists) return;
      if ((previous.get('count')??-1) <= source.size) tx.set(headRef,{jobId:id,count:source.size,nextAt:previous.get('nextAt')??deps.now()});
      tx.create(ref, { count:source.size, head, kind, group, uid, evidence, status: 'queued', attempts: 0, nextAt: room.get('endedAt') ? deps.now() : Math.max(deps.now(),previous.get('nextAt')??0), createdAt: deps.now(), deleteAt: Timestamp.fromMillis(deps.now() + RETENTION.discussionMs) });
    });
    return id;
  }
  async function run(roomId: string, maximum = 4) {
    const jobs = await roomRef(roomId).collection('processingJobs').where('status','in',['queued','running']).limit(100).get();
    let processed = 0;
    for (const job of jobs.docs) {
      if (processed >= maximum) break;
      const claim = await roomTransaction(deps.db,roomId,async tx => {
        const room = await tx.get(roomRef(roomId));
        const row = await tx.get(job.ref);
        if(row.get('status')==='running'&&row.get('leaseUntil')>deps.now())return null;
        if (row.exists && row.get('head')) {
          const head = await tx.get(roomRef(roomId).collection('processingHeads').doc(row.get('head')));
          if (head.get('jobId') !== job.id) {tx.update(job.ref,{status:'done',superseded:true,evidence:FieldValue.delete()});return null;}
        }
        if (!room.exists || room.get('deleting') || !row.exists || ['done','failed'].includes(row.get('status')) || row.get('nextAt') > deps.now() || (row.get('status') === 'running' && row.get('leaseUntil') > deps.now())) return null;
        if (row.get('attempts') >= RETENTION.maxAttempts) { tx.update(job.ref,{status:'failed',error:'attempts_exhausted'}); return null; }
        const lease = randomUUID(); tx.update(job.ref,{status:'running',lease,leaseUntil:deps.now()+RETENTION.jobLeaseMs,attempts:row.get('attempts')+1});
        return {...row.data()!, lease} as Job;
      });
      if (!claim) continue; processed++;
      try {
        const evidence = claim.evidence as Evidence[];
        let result: object;
        if (claim.kind === 'insights') {
          const opinions = await roomRef(roomId).collection('privateOpinions').get();
          const active = await roomRef(roomId).collection('members').get();
          const allowed = new Set(active.docs.filter(m=>m.get('role')==='participant' && m.get('status')==='active' && m.get('group')===claim.group).map(m=>m.id));
          const texts = opinions.docs.filter(d=>allowed.has(d.id)).map(d=>d.get('text'));
          const points = texts.length ? await deps.gemini.findPoints(texts,evidence.map(x=>x.text)) : [];
          result = { group:claim.group, points, source:deps.gemini.source, basedOn:'transcript', updatedAt:FieldValue.serverTimestamp() };
        } else {
          if (evidence.length && !deps.gemini.reviewEvidence) throw new Error('review_unavailable');
          const review = evidence.length ? await deps.gemini.reviewEvidence!(claim.kind === 'group' ? 'session' : claim.kind,evidence) : {observations:[],nextSteps:[]};
          result = { ...review, group:claim.group, uid:claim.uid, source:evidence.length?deps.gemini.source:'none', evidenceCount:evidence.length, updatedAt:FieldValue.serverTimestamp() };
        }
        await roomTransaction(deps.db,roomId,async tx => {
          const output = claim.kind === 'participant' ? roomRef(roomId).collection('participantFeedback').doc(claim.uid) : roomRef(roomId).collection('results').doc(claim.kind === 'insights' ? `live-g${claim.group}` : claim.kind === 'group' ? `review-g${claim.group}` : 'session-review');
          const session = await tx.get(roomRef(roomId));
          const [latest, head, existing] = await tx.getAll(job.ref, roomRef(roomId).collection('processingHeads').doc(claim.head), output);
          if (!session.exists || session.get('deleting') || latest.get('lease') !== claim.lease || latest.get('status') !== 'running' || !head.exists) return;
          if((existing.get('basedOnCount')??-1)>claim.count){tx.update(job.ref,{status:'done',superseded:true,evidence:FieldValue.delete()});return;}
          if (claim.kind === 'participant') {
            const owner = await tx.get(roomRef(roomId).collection('members').doc(claim.uid));
            if (owner.get('status') !== 'active') { tx.update(job.ref,{status:'failed',error:'member_removed'}); return; }
          }
          const proposals = claim.kind === 'insights' ? await tx.get(roomRef(roomId).collection('insights').where('group','==',claim.group)) : null;
          if (proposals) {
            const decided = new Set(proposals.docs.filter(d=>d.get('status')!=='pending').map(d=>d.get('summary')));
            const points = (result as {points:{summary:string;discussed:boolean}[]}).points;
            for (const d of proposals.docs) if (d.get('status')==='pending') tx.delete(d.ref);
            for (const point of points.filter(p=>!p.discussed&&!decided.has(p.summary))) tx.create(roomRef(roomId).collection('insights').doc(),{summary:point.summary,group:claim.group,status:'pending',source:deps.gemini.source,createdAt:FieldValue.serverTimestamp()});
          }
          tx.set(output,{...result,jobId:job.id,basedOnCount:claim.count});
          tx.update(roomRef(roomId).collection('processingHeads').doc(claim.head),{nextAt:deps.now()+30000}); tx.update(job.ref,{status:'done',finishedAt:deps.now(),evidence:FieldValue.delete()});
        });
      } catch {
        await roomTransaction(deps.db,roomId,async tx => {
          const row = await tx.get(job.ref); if (!row.exists || row.get('lease') !== claim.lease) return;
          const failed = row.get('attempts') >= RETENTION.maxAttempts;
          tx.update(job.ref,{status:failed?'failed':'queued',error:'analysis_unavailable',nextAt:deps.now()+5000*row.get('attempts'),leaseUntil:0});
        });
      }
    }
    return { processed };
  }
  async function speakingMetrics(roomId: string, group: number) {
    const state = await roomRef(roomId).collection('speaking').doc(String(group)).get();
    const talk = (state.get('talkMs')??{}) as Record<string,number>, unknownMs = Number(state.get('unknownMs')??0), total = Object.values(talk).reduce((a,b)=>a+b,0)+unknownMs;
    return {group,talkMs:talk,unknownMs,totalSpeechMs:total,ratios:Object.fromEntries(Object.entries(talk).map(([id,ms])=>[id,total?ms/total:null])),fairness:participationFairness(Object.values(talk)),basis:'estimated-speech-duration',source:state.get('source')??null};
  }
  return {enqueue,run,speakingMetrics};
}
