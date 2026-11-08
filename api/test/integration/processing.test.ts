import { wave } from '../fixtures/audio.js';
import { beforeEach, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, Firestore } from 'firebase-admin/firestore';
import { emulatorGoogleUser } from '../../../firebase/emulator-auth.mjs';
import { demoFirestore } from '../../src/demo-firestore.js';
import { createApp } from '../../src/app.js';
import { mockGemini } from '../../src/gemini.js';
import { createProcessing } from '../../src/processing.js';
import { createMaintenance, deleteDiscussion } from '../../src/maintenance.js';
import { RETENTION } from '../../src/processing-types.js';
import type { SpeechSegment } from '../../src/processing-types.js';
const projectId=process.env.GOOGLE_CLOUD_PROJECT;
if(!projectId?.startsWith('demo-'))throw new Error('Emulator required');
initializeApp({projectId});const db=getFirestore(),auth=getAuth();
let now=Date.now(), fail=false, segments:SpeechSegment[]=[], during:(()=>Promise<void>)|undefined;
const gemini={...mockGemini(),transcribe:async(input:{audio:Buffer;mimeType:string;durationSec:number})=>{
  expect(input.audio.toString('ascii',0,4)).toBe('RIFF');expect(input.audio.readUInt32LE(24)).toBe(16000);
  if(during){const fn=during;during=undefined;await fn();}if(fail)throw new Error('private failure');return segments;
}};
const deps={db,auth,gemini,now:()=>now},app=createApp(deps),jobs=createProcessing(deps);
beforeEach(()=>{now=Date.now();fail=false;segments=[{startMs:0,endMs:1000,text:'理由を説明します。'}];during=undefined;});
async function client(kind:'teacher'|'student'='student'){
  const u=await emulatorGoogleUser(kind,`processing-${randomUUID()}`);
  const s=await request(app).post('/sessions').set('authorization',`Bearer ${u.idToken}`).send({deviceLabel:'test',deviceType:'pc'}).expect(201);
  const headers={authorization:`Bearer ${u.idToken}`,cookie:s.headers['set-cookie'][0].split(';')[0]};
  return{uid:u.localId,headers,post:(path:string,body:object={})=>request(app).post(path).set(headers).send(body),get:(path:string)=>request(app).get(path).set(headers)};
}
type Client=Awaited<ReturnType<typeof client>>;
async function setup(){
  const h=await client('teacher'),p=await client(),q=await client();
  const room=(await h.post('/rooms',{title:'Processing',flowVersion:1,groups:2,publishOnEnd:false}).expect(201)).body;
  for(const c of[p,q])await c.post('/rooms/join',{code:room.joinCode}).expect(200);
  await h.post(`/rooms/${room.roomId}/groups/assign`,{uid:p.uid,group:1}).expect(200);
  await h.post(`/rooms/${room.roomId}/groups/assign`,{uid:q.uid,group:2}).expect(200);
  const ref=db.doc(`sessions/${room.roomId}`);await ref.update({phase:'discussing',startedAt:Timestamp.fromMillis(now-1000)});
  return{h,p,q,id:room.roomId as string,ref};
}
const audio=(c:Client,id:string,seq=0,pcm=Buffer.alloc(32000,1))=>request(app).post(`/rooms/${id}/transcripts/audio?sequence=${seq}`).set(c.headers).set('content-type','audio/pcm').send(pcm);
it('PCMを文字起こしし、同一再送は冪等、順序・内容違いは拒否、原音を永続化しない',async()=>{
  const {h,p,id,ref}=await setup();await audio(p,id).expect(200);await audio(p,id).expect(200);await audio(p,id,0,Buffer.alloc(32000,2)).expect(409);await audio(p,id,3).expect(409);
  const docs=await ref.collection('transcripts').get();expect(docs.size).toBe(1);expect(docs.docs[0].get('attribution')).toBe('unknown');expect(docs.docs[0].get('ownerUid')).toBeNull();
  const data=(await h.get(`/rooms/${id}/transcripts?group=1`).expect(200)).body;expect(data.segments).toHaveLength(1);expect(JSON.stringify(data)).not.toContain('sourceUid');
  for(const collection of['transcriptBatches','transcriptionSources','processingJobs'])for(const d of(await ref.collection(collection).get()).docs)expect(JSON.stringify(d.data())).not.toMatch(/"(pcm|audio|embedding)":/);
});
it('未参加・他グループ・Host音声送信と非公開結果を拒否する',async()=>{
  const {h,p,q,id}=await setup(),outsider=await client();
  await audio(outsider,id).expect(403);await audio(h,id).expect(403);await audio(p,id).expect(200);
  await q.get(`/rooms/${id}/transcripts?group=1`).expect(403);await p.get(`/rooms/${id}/transcripts?group=1`).expect(403);
  await p.get(`/rooms/${id}/speaking-metrics?group=1`).expect(403);
  await p.post(`/rooms/${id}/processing/run`).expect(403);await p.get(`/rooms/${id}/processing`).expect(403);await p.post(`/rooms/${id}/review`).expect(403);
  await p.post(`/rooms/${id}/feedback`).expect(409);await p.get(`/rooms/${id}/feedback/${q.uid}`).expect(403);
});
it('指定された録音担当、受付期間、PCM形式を検証する',async()=>{
  const {p,q,id,ref}=await setup();await audio(p,id,0,Buffer.alloc(31999)).expect(400);
  await ref.collection('groups').doc('1').set({recorderUid:q.uid});await audio(p,id).expect(403);
  await ref.collection('groups').doc('1').set({recordingMode:'personal'});await audio(p,id).expect(403);
  await ref.collection('members').doc(p.uid).update({deviceMode:'personal'});await audio(p,id).expect(200);
  await ref.update({endedAt:Timestamp.fromMillis(now-RETENTION.uploadMs-1)});await audio(p,id,1).expect(409);
});
it('モデル失敗は同じ音声を再送でき、音声区間の不正値は保存しない',async()=>{
  const {p,id,ref}=await setup();fail=true;await audio(p,id).expect(503);expect((await ref.collection('transcripts').get()).empty).toBe(true);
  fail=false;segments=[{startMs:-1,endMs:100,text:'bad'},{startMs:0,endMs:1001,text:'bad'},{startMs:0,endMs:1000,text:'valid'}];await audio(p,id).expect(200);expect((await ref.collection('transcripts').get()).size).toBe(1);
});
it('モデル待機中の所属解除では保存せず、内部例外を応答に出さない',async()=>{
  const {p,id,ref}=await setup();during=()=>ref.collection('members').doc(p.uid).update({status:'inactive'}).then(()=>{});
  const response=await audio(p,id).expect(409);expect(JSON.stringify(response.body)).not.toContain('private failure');expect((await ref.collection('transcripts').get()).empty).toBe(true);
});
it('十分な話者区間だけを本人と対応付け、根拠のない個人フィードバックを作らない',async()=>{
  const {h,p,q,id,ref}=await setup();await ref.collection('members').doc(p.uid).update({attendees:[{id:'speaker-a',displayName:'A'}]});
  await ref.collection('speakerEvents').doc('event').set({group:1,uid:'speaker-a',startedAt:now-1000,speechMs:1000});await audio(p,id).expect(200);
  expect((await ref.collection('transcripts').get()).docs[0].get('ownerUid')).toBe(p.uid);
  await ref.update({endedAt:Timestamp.fromMillis(now)});
  await p.post(`/rooms/${id}/feedback`).expect(202);await h.post(`/rooms/${id}/feedback`,{uid:q.uid}).expect(202);await h.post(`/rooms/${id}/review`).expect(202);
  await jobs.run(id,10);await p.get(`/rooms/${id}/feedback/${p.uid}`).expect(403);await ref.update({resultsPublished:true});
  const result=(await p.get(`/rooms/${id}/feedback/${p.uid}`).expect(200)).body;expect(result.evidenceCount).toBe(1);expect(result.observations).toHaveLength(1);
  const empty=(await q.get(`/rooms/${id}/feedback/${q.uid}`).expect(200)).body;expect(empty.observations).toEqual([]);await p.get(`/rooms/${id}/feedback/${q.uid}`).expect(403);
  await p.get(`/rooms/${id}/transcripts?group=1`).expect(200);
});
it('別端末で重複した文字起こしを統合し、曖昧な話者を本人へ割り当てない',async()=>{
  const {p,q,id,ref}=await setup();await ref.collection('members').doc(q.uid).update({group:1});
  await ref.collection('speakerEvents').doc('unknown').set({group:1,uid:null,startedAt:now-1000,speechMs:1000});
  const independent=new Firestore({projectId}),second=createApp({...deps,db:independent});
  try{await Promise.all([audio(p,id).expect(200),request(second).post(`/rooms/${id}/transcripts/audio?sequence=0`).set(q.headers).set('content-type','audio/pcm').send(Buffer.alloc(32000,1)).expect(200)]);expect((await ref.collection('transcripts').get()).size).toBe(1);}finally{await independent.terminate();}
},15000); // Firestore concurrent-transaction backoff is part of this assertion.
it('永続ジョブのleaseを回収し、同じ入力の再投入で結果を増殖させない',async()=>{
  const {id,ref}=await setup();await ref.collection('transcripts').doc('a').set({group:1,ownerUid:'person',text:'根拠',startMs:0});
  const job=await jobs.enqueue(id,'group',1);expect(await jobs.enqueue(id,'group',1)).toBe(job);
  await ref.collection('processingJobs').doc(job).update({status:'running',leaseUntil:now+1000});expect((await jobs.run(id)).processed).toBe(0);
  now+=1001;expect((await jobs.run(id)).processed).toBe(1);expect((await ref.collection('results').doc('review-g1').get()).get('evidenceCount')).toBe(1);
  expect((await ref.collection('processingJobs').doc(job).get()).get('evidence')).toBeUndefined();expect((await jobs.run(id)).processed).toBe(0);
});
it('分析失敗を最大3回まで再試行し、実行中の削除や除外で結果を復活させない',async()=>{
  const {id,ref,p}=await setup();await ref.collection('transcripts').doc('reason').set({group:1,text:'reason',startMs:0});const bad=createProcessing({...deps,gemini:{...gemini,reviewEvidence:async()=>{throw new Error('secret');}}});
  const id1=await bad.enqueue(id,'session');for(let i=0;i<3;i++){await bad.run(id);now+=20000;}
  expect((await ref.collection('processingJobs').doc(id1).get()).get('status')).toBe('failed');
  await ref.collection('members').doc(p.uid).update({status:'inactive'});const id2=await jobs.enqueue(id,'participant',1,p.uid);await jobs.run(id);
  expect((await ref.collection('processingJobs').doc(id2).get()).get('error')).toBe('member_removed');expect((await ref.collection('participantFeedback').get()).empty).toBe(true);
  const dangerous=createProcessing({...deps,gemini:{...gemini,reviewEvidence:async()=>{await deleteDiscussion(deps,id);return{observations:[],nextSteps:[]};}}});await dangerous.enqueue(id,'group',1);await dangerous.run(id);expect((await ref.get()).exists).toBe(false);expect((await ref.collection('results').get()).empty).toBe(true);
});
it('保存期限処理でセッションと参加コード・個人参照・音声特徴・認証履歴を削除する',async()=>{
  const scoped=demoFirestore(db,`pr999-${randomUUID().replaceAll('-','')}`), isolated={...deps,db:scoped}, ref=scoped.doc('sessions/expired');
  await ref.set({createdAt:Timestamp.fromMillis(now),retentionUntil:Timestamp.fromMillis(now-1),joinCode:'123456'});
  await ref.collection('members').doc('person').set({role:'participant',status:'active'});
  await scoped.doc('users/person').set({});await scoped.doc('users/person/discussions/expired').set({role:'participant'});
  await scoped.doc('joinCodes/123456').set({roomId:'expired'});
  const user=scoped.doc('users/person');await user.collection('voiceProfiles').doc('default').set({updatedAt:Timestamp.fromMillis(now-RETENTION.voiceMs-1),embedding:[1,0]});
  await user.collection('sessions').doc('old').set({deleteAt:Timestamp.fromMillis(now-1)});
  await scoped.doc('securityEvents/expired').set({deleteAt:Timestamp.fromMillis(now-1)});
  await createMaintenance(isolated).tick();
  expect((await ref.get()).exists).toBe(false);expect((await user.collection('voiceProfiles').doc('default').get()).exists).toBe(false);expect((await user.collection('sessions').doc('old').get()).exists).toBe(false);
  expect((await user.collection('discussions').doc('expired').get()).exists).toBe(false);expect((await scoped.doc('joinCodes/123456').get()).exists).toBe(false);
});
it('終了後の明示削除と公開権限、時間と不明時間を含めた発言率',async()=>{
  const {h,p,id,ref}=await setup();await ref.collection('speaking').doc('1').set({talkMs:{a:3000,b:1000},unknownMs:1000,source:'model'});
  const data=(await h.get(`/rooms/${id}/speaking-metrics?group=1`).expect(200)).body;expect(data.ratios).toEqual({a:.6,b:.2});expect(data.totalSpeechMs).toBe(5000);
  await ref.update({participantView:{speaking:true},endedAt:Timestamp.fromMillis(now),resultsPublished:true});await p.get(`/rooms/${id}/speaking-metrics?group=1`).expect(200);
  await p.post(`/rooms/${id}/delete`,{confirm:true}).expect(403);await h.post(`/rooms/${id}/delete`,{confirm:false}).expect(400);await h.post(`/rooms/${id}/delete`,{confirm:true}).expect(200);expect((await ref.get()).exists).toBe(false);
});
it('終了したセッションは自動でグループ・本人・全体の分析を準備する',async()=>{
  const scoped=demoFirestore(db,`pr999-${randomUUID().replaceAll('-','')}`),isolated={...deps,db:scoped},ref=scoped.doc('sessions/finished');
  await ref.set({flowVersion:1,transcriptRevision:1,phase:'consensus',endedAt:Timestamp.fromMillis(now),createdAt:Timestamp.fromMillis(now)});
  await ref.collection('members').doc('person').set({role:'participant',status:'active',group:1});
  await ref.collection('transcriptionSources').doc('source').set({sequence:1});
  const worker=createMaintenance(isolated);for(let i=0;i<4;i++)await worker.tick();
  expect((await ref.collection('results').doc('session-review').get()).exists).toBe(true);expect((await ref.collection('results').doc('review-g1').get()).exists).toBe(true);
});
it('録音の保存期限は所属と終了時刻に従い、他人の所属やデータを返さない',async()=>{
  const {p,id,ref}=await setup();await ref.update({endedAt:Timestamp.fromMillis(now)});
  const result=(await p.post('/recordings/retention',{roomIds:[id,'unknown']}).expect(200)).body;
  expect(result.deadlines[id]).toBe(now+RETENTION.uploadMs);expect(result.deadlines.unknown).toBe(now);
  await p.post('/recordings/retention',{roomIds:['../outside']}).expect(400);
});
it('文字起こし処理中にHostが録音担当を変更した場合は保存しない',async()=>{
  const {p,q,id,ref}=await setup();during=()=>ref.collection('groups').doc('1').set({recorderUid:q.uid}).then(()=>{});
  await audio(p,id).expect(403);expect((await ref.collection('transcripts').get()).empty).toBe(true);
});
it('Hostだけが失敗済みの最新ジョブを再試行できる',async()=>{
  const {h,p,id,ref}=await setup(),job=await jobs.enqueue(id,'session');
  await p.post(`/rooms/${id}/processing/${job}/retry`).expect(403);
  await h.post(`/rooms/${id}/processing/${job}/retry`).expect(409);
  await ref.collection('processingJobs').doc(job).update({status:'failed',attempts:3,error:'analysis_unavailable'});
  await h.post(`/rooms/${id}/processing/${job}/retry`).expect(202);await jobs.run(id);
  expect((await ref.collection('processingJobs').doc(job).get()).get('status')).toBe('done');
  await h.post(`/rooms/${id}/processing/${'a'.repeat(64)}/retry`).expect(404);
});
it('旧形式のデータを期限巡回で勝手に削除しない',async()=>{
  const scoped=demoFirestore(db,`pr999-${randomUUID().replaceAll('-','')}`),ref=scoped.doc('sessions/legacy');
  await ref.set({phase:'closed',createdAt:Timestamp.fromMillis(now-RETENTION.discussionMs-1000)});
  await createMaintenance({...deps,db:scoped}).tick();expect((await ref.get()).exists).toBe(true);
});
it('発言のない終了済みセッションには空の本人結果を返し、AIを呼ばない',async()=>{
  const {p,id,ref}=await setup();await ref.update({endedAt:Timestamp.fromMillis(now),resultsPublished:true});
  expect((await p.get(`/rooms/${id}/feedback/${p.uid}`).expect(200)).body).toMatchObject({source:'none',evidenceCount:0,observations:[]});
});
it('モデルの応答待ちに次の音声が来ても最初の有効な分析を表示し、更新を止めない',async()=>{
  const {id,ref}=await setup();await ref.collection('transcripts').doc('first').set({group:1,text:'first',startMs:0});
  const processor=createProcessing({...deps,gemini:{...gemini,reviewEvidence:async(_kind,evidence)=>{
    await ref.collection('transcripts').doc('second').set({group:1,text:'second',startMs:1000});await jobs.enqueue(id,'group',1);
    return {observations:[{evidenceId:evidence[0].id,text:'older valid result'}],nextSteps:[]};
  }}});
  await processor.enqueue(id,'group',1);await processor.run(id,1);expect((await ref.collection('results').doc('review-g1').get()).get('basedOnCount')).toBe(1);
  await jobs.run(id);expect((await ref.collection('results').doc('review-g1').get()).get('basedOnCount')).toBe(2);
});
it('古いモデル応答が遅れても、新しい分析結果を上書きしない',async()=>{
  const {id,ref}=await setup();await ref.collection('transcripts').doc('first').set({group:1,text:'first',startMs:0});
  let release!:()=>void,entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;}),barrier=new Promise<void>(resolve=>{release=resolve;});
  const slow=createProcessing({...deps,gemini:{...gemini,reviewEvidence:async()=>{entered();await barrier;return{observations:[],nextSteps:[]};}}});
  await slow.enqueue(id,'group',1);const running=slow.run(id,1);await started;
  await ref.collection('transcripts').doc('second').set({group:1,text:'second',startMs:1000});await jobs.enqueue(id,'group',1);await jobs.run(id);
  release();await running;expect((await ref.collection('results').doc('review-g1').get()).get('basedOnCount')).toBe(2);
});
it('音声の自動送信・分析ポーリングでログインの最終利用時刻を延長しない',async()=>{
  const {h,p,id}=await setup();const participant=(await db.collection(`users/${p.uid}/sessions`).get()).docs[0],host=(await db.collection(`users/${h.uid}/sessions`).get()).docs[0];
  const before=participant.get('lastActivityAt').toMillis(),hostBefore=host.get('lastActivityAt').toMillis();now+=60000;
  await audio(p,id).expect(200);await h.post(`/rooms/${id}/processing/run`).expect(200);
  expect((await participant.ref.get()).get('lastActivityAt').toMillis()).toBe(before);expect((await host.ref.get()).get('lastActivityAt').toMillis()).toBe(hostBefore);
});
it('各自端末モードは登録した各端末の録音を受け付け、共有端末の送信を拒否する',async()=>{
  const {p,q,id,ref}=await setup();await ref.update({'groupState.1.status':'discussing'});
  await ref.collection('groups').doc('1').set({recordingMode:'personal',recorderUid:p.uid});
  await ref.collection('members').doc(q.uid).update({group:1,deviceMode:'shared'});
  const send=()=>request(app).post(`/rooms/${id}/groups/recording?durationSec=2`).set(q.headers).set('content-type','audio/wav').send(wave(2,8000));
  await send().expect(403);await ref.collection('members').doc(q.uid).update({deviceMode:'personal'});await send().expect(200);
});
