import { roomTransaction } from './room-transaction.js';
import express, { type Express } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import type { Dependencies } from './dependencies.js';
import { HttpError, parse, wrap, type Handler } from './http.js';
import { createProcessing } from './processing.js';
import { createLimiter } from './limits.js';
import { RETENTION } from './processing-types.js';
import { deleteDiscussion } from './maintenance.js';
import { readSessionCookie } from './session-routes.js';
import { createSessions } from './sessions.js';

function wav(pcm: Buffer) {
  const output = Buffer.alloc(44 + pcm.length); output.write('RIFF'); output.writeUInt32LE(36+pcm.length,4); output.write('WAVEfmt ',8); output.writeUInt32LE(16,16); output.writeUInt16LE(1,20); output.writeUInt16LE(1,22); output.writeUInt32LE(16000,24); output.writeUInt32LE(32000,28); output.writeUInt16LE(2,32); output.writeUInt16LE(16,34); output.write('data',36); output.writeUInt32LE(pcm.length,40); pcm.copy(output,44); return output;
}
export function registerTranscriptRoutes(app: Express, deps: Dependencies, handlers: {authenticate:Handler;member:Handler;host:Handler}) {
  const {authenticate,member,host}=handlers, jobs=createProcessing(deps),limit=createLimiter(deps.db,deps.now);
  const root=(id:string)=>deps.db.doc(`sessions/${id}`);
  app.post('/recordings/retention',authenticate,wrap(async(req,res)=>{
    await limit(req.ctx.uid,'processing',12);
    const {roomIds}=parse(z.object({roomIds:z.array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)).max(100)}).strict(),req.body);
    const deadlines:Record<string,number>={};
    for(const id of new Set(roomIds)){
      const [room,own]=await deps.db.getAll(root(id),root(id).collection('members').doc(req.ctx.uid));
      deadlines[id]=!room.exists||own.get('status')!=='active'?deps.now():(room.get('endedAt')??room.get('expiresAt'))?.toMillis?.()+RETENTION.uploadMs;
      if(!Number.isFinite(deadlines[id]))deadlines[id]=deps.now();
    }
    res.json({deadlines});
  }));
  app.post('/rooms/:roomId/transcripts/audio',authenticate,member,express.raw({type:'audio/pcm',limit:640000}),wrap(async(req,res)=>{
    const pcm=req.body;
    if(!Buffer.isBuffer(pcm)||pcm.length<32000||pcm.length>640000||pcm.length%32000) { if(Buffer.isBuffer(pcm))pcm.fill(0); throw new HttpError(400,'invalid_audio','1〜20秒の16kHz mono PCM16音声を送ってください'); }
    try {
    const seq=parse(z.coerce.number().int().min(0).max(1800),req.query.sequence);
    const durationMs=pcm.length/32,ref=root(req.params.roomId),own=await ref.collection('members').doc(req.ctx.uid).get(),room=await ref.get();
    if(own.get('role')!=='participant'||!own.get('group'))throw new HttpError(403,'participant_only','参加者の所属を確認してください');
    const group=own.get('group') as number,config=await ref.collection('groups').doc(String(group)).get();
    if(config.get('recordingMode')==='personal'&&own.get('deviceMode')!=='personal')throw new HttpError(403,'personal_device_required','各自端末の登録が必要です');
    if(room.get('recording')===false||(config.get('recordingMode')!=='personal'&&config.get('recorderUid')&&config.get('recorderUid')!==req.ctx.uid))throw new HttpError(403,'not_recorder','録音担当だけが送信できます');
    if(room.get('flowVersion')!==1||room.get('phase')==='collecting'||room.get('phase')==='closed'||(room.get('endedAt')&&deps.now()>room.get('endedAt').toMillis()+RETENTION.uploadMs))throw new HttpError(409,'not_discussing','音声の受付時間外です');
    await limit(req.ctx.uid,'transcript',30);
    const capture=parse(z.string().uuid().optional(),req.query.capture);
    const source=createHash('sha256').update(`${req.ctx.uid}:${req.ctx.session!.sessionId}:${capture??'default'}`).digest('hex'),batchRef=ref.collection('transcriptBatches').doc(`${source}-${seq}`),sourceRef=ref.collection('transcriptionSources').doc(source);
    const digest=createHash('sha256').update(pcm).digest('hex'),lease=randomUUID();
    const claim=await roomTransaction(deps.db,req.params.roomId,async tx=>{
      const [batch,position]=await tx.getAll(batchRef,sourceRef);
      if(batch.exists&&batch.get('digest')!==digest)throw new HttpError(409,'audio_conflict','同じ区間に異なる音声を送信できません');
      if(batch.get('status')==='done')return {done:true,startAt:batch.get('startAt') as number};
      if(batch.get('status')==='running'&&batch.get('leaseUntil')>deps.now())throw new HttpError(409,'transcription_running','同じ区間を処理しています');
      const expected=position.get('sequence')??0;if(expected!==seq)throw new HttpError(409,'audio_sequence','音声を順番に送信してください');
      const startAt=position.get('nextAt')??deps.now()-durationMs;
      tx.set(batchRef,{digest,lease,status:'running',leaseUntil:deps.now()+RETENTION.jobLeaseMs,startAt,group,uid:req.ctx.uid});return {done:false,startAt};
    });
    try {
      if(claim.done){await Promise.all([jobs.enqueue(req.params.roomId,'insights',group),jobs.enqueue(req.params.roomId,'group',group)]);res.json({ok:true,duplicate:true});return;}
      if(!deps.gemini.transcribe)throw new HttpError(503,'transcription_unavailable','文字起こしの接続設定が必要です');
      const audio=wav(pcm);let segments;
      try{segments=await deps.gemini.transcribe({audio,mimeType:'audio/wav',durationSec:durationMs/1000});}finally{audio.fill(0);}
      await createSessions(deps.db,deps.now).validate(req.ctx.token!,readSessionCookie(req));
      const events=await ref.collection('speakerEvents').where('startedAt','>=',claim.startAt-1000).where('startedAt','<',claim.startAt+durationMs).get();
      await roomTransaction(deps.db,req.params.roomId,async tx=>{
        const current=await tx.get(ref);
        const [batch,membership,currentConfig]=await tx.getAll(batchRef,ref.collection('members').doc(req.ctx.uid),ref.collection('groups').doc(String(group)));
        if(current.get('recording')===false||(currentConfig.get('recordingMode')==='personal'&&membership.get('deviceMode')!=='personal')||(currentConfig.get('recordingMode')!=='personal'&&currentConfig.get('recorderUid')&&currentConfig.get('recorderUid')!==req.ctx.uid))throw new HttpError(403,'not_recorder','録音担当が変更されました');
        if(current.get('phase')==='closed'||(current.get('endedAt')&&deps.now()>current.get('endedAt').toMillis()+RETENTION.uploadMs))throw new HttpError(409,'not_discussing','音声の受付時間外です');
        if(!current.exists||current.get('deleting')||batch.get('lease')!==lease||membership.get('status')!=='active'||membership.get('group')!==group)throw new HttpError(409,'stale_transcription','参加状態が変わりました');
        const existing=await tx.get(ref.collection('transcripts').where('startAt','>=',claim.startAt-20000).where('startAt','<',claim.startAt+durationMs));
        const pending: {id:string;data:Record<string,unknown>}[]=[];
        for(const [index,part]of segments.entries()){
          if(!Number.isFinite(part.startMs)||!Number.isFinite(part.endMs)||part.startMs<0||part.endMs<=part.startMs||part.endMs>durationMs||!part.text.trim())continue;
          const startAt=claim.startAt+part.startMs,endAt=claim.startAt+part.endMs,normalized=part.text.replace(/[\s、。,.!?！？]/g,'');
          if(existing.docs.some(d=>d.get('group')===group&&d.get('sourceUid')!==req.ctx.uid&&d.get('normalized')===normalized&&Math.min(endAt,d.get('endAt'))-Math.max(startAt,d.get('startAt'))>Math.min(endAt-startAt,d.get('endAt')-d.get('startAt'))*.5))continue;
          const overlaps=events.docs.filter(e=>e.get('group')===group&&e.get('startedAt')<endAt&&e.get('startedAt')+1000>startAt&&e.get('speechMs')>0);
          const voices=new Set(overlaps.map(e=>e.get('uid')).filter(Boolean));
          const known=overlaps.filter(e=>e.get('uid'));
          const covered=known.reduce((n,e)=>n+Math.min(1000,Math.max(0,Math.min(endAt,e.get('startedAt')+1000)-Math.max(startAt,e.get('startedAt')))),0);
          const speaker=voices.size===1&&known.length>=overlaps.length*.8&&covered>=(endAt-startAt)*.6?[...voices][0]as string:null;
          const owner=speaker?((await tx.get(ref.collection('members').where('group','==',group))).docs.find(m=>(m.get('attendees')??[]).some((a:{id:string})=>a.id===speaker))?.id??null):null;
          const id=`${source}-${seq}-${index}`;
          pending.push({id,data:{group,text:part.text.slice(0,1000),normalized,startAt,endAt,startMs:Math.max(0,startAt-(current.get('startedAt')?.toMillis()??claim.startAt)),endMs:Math.max(0,endAt-(current.get('startedAt')?.toMillis()??claim.startAt)),sourceUid:req.ctx.uid,speakerId:speaker,ownerUid:owner,attribution:speaker?'estimated':'unknown',source:deps.gemini.source,createdAt:FieldValue.serverTimestamp()}});
        }
        for(const row of pending)tx.create(ref.collection('transcripts').doc(row.id),row.data);
        tx.update(batchRef,{status:'done',count:pending.length,finishedAt:deps.now()});tx.set(sourceRef,{sequence:seq+1,nextAt:claim.startAt+durationMs,uid:req.ctx.uid,group});
      });
      await Promise.all([jobs.enqueue(req.params.roomId,'insights',group),jobs.enqueue(req.params.roomId,'group',group)]);res.json({ok:true,source:deps.gemini.source});
    }catch(error){await roomTransaction(deps.db,req.params.roomId,async tx=>{const row=await tx.get(batchRef);if(row.exists&&row.get('lease')===lease&&row.get('status')!=='done')tx.update(batchRef,{status:'retry',leaseUntil:0});});if(error instanceof HttpError)throw error;throw new HttpError(503,'transcription_unavailable','文字起こしを再試行してください。元の録音は端末に保管されています');}
    } finally{pcm.fill(0);}
  }));
  app.get('/rooms/:roomId/transcripts',authenticate,member,wrap(async(req,res)=>{
    const group=parse(z.coerce.number().int().min(1).max(12),req.query.group),ref=root(req.params.roomId),own=await ref.collection('members').doc(req.ctx.uid).get();
    if(req.ctx.role!=='host'&&own.get('group')!==group)throw new HttpError(403,'other_group','所属グループだけ閲覧できます');
    const session=await ref.get();
    if(req.ctx.role!=='host'&&(!session.get('endedAt')||!session.get('resultsPublished')))throw new HttpError(403,'not_published','終了後に公開された文字起こしだけ閲覧できます');
    const docs=await ref.collection('transcripts').where('group','==',group).get();
    res.json({segments:docs.docs.sort((a,b)=>a.get('startMs')-b.get('startMs')).slice(-500).map(d=>({id:d.id,text:d.get('text'),startMs:d.get('startMs'),endMs:d.get('endMs'),speakerId:d.get('speakerId'),attribution:d.get('attribution'),source:d.get('source')}))});
  }));
  app.get('/rooms/:roomId/speaking-metrics',authenticate,member,wrap(async(req,res)=>{
    const own=await root(req.params.roomId).collection('members').doc(req.ctx.uid).get(),group=parse(z.coerce.number().int().min(1).max(12),req.query.group);
    if(req.ctx.role!=='host'&&own.get('group')!==group)throw new HttpError(403,'other_group','所属グループだけ閲覧できます');
    const session=await root(req.params.roomId).get();
    if(req.ctx.role!=='host'&&(session.get('participantView.speaking')!==true||(session.get('endedAt')&&!session.get('resultsPublished'))))throw new HttpError(403,'not_published','Hostが公開した情報だけ閲覧できます');
    res.json(await jobs.speakingMetrics(req.params.roomId,group));
  }));
  app.post('/rooms/:roomId/processing/run',authenticate,member,host,wrap(async(req,res)=>{await limit(req.ctx.uid,'processing',12);res.json(await jobs.run(req.params.roomId));}));
  app.post('/rooms/:roomId/processing/:jobId/retry',authenticate,member,host,wrap(async(req,res)=>{
    const jobId=parse(z.string().regex(/^[a-f0-9]{64}$/),req.params.jobId);
    await limit(req.ctx.uid,'processing',12);
    await roomTransaction(deps.db,req.params.roomId,async tx=>{
      const ref=root(req.params.roomId).collection('processingJobs').doc(jobId),job=await tx.get(ref);
      if(!job.exists)throw new HttpError(404,'job_not_found','処理がありません');
      if(job.get('status')!=='failed')throw new HttpError(409,'job_not_failed','再試行が必要な処理だけ選べます');
      const head=await tx.get(root(req.params.roomId).collection('processingHeads').doc(job.get('head')));
      if(head.get('jobId')!==jobId)throw new HttpError(409,'job_superseded','新しい処理を確認してください');
      tx.update(ref,{status:'queued',attempts:0,nextAt:deps.now(),leaseUntil:0,error:FieldValue.delete()});
    });res.status(202).json({ok:true});
  }));
  app.get('/rooms/:roomId/processing',authenticate,member,host,wrap(async(req,res)=>{
    const docs=await root(req.params.roomId).collection('processingJobs').where('status','in',['queued','running','failed']).limit(100).get();res.json({jobs:docs.docs.map(d=>({id:d.id,kind:d.get('kind'),status:d.get('status'),attempts:d.get('attempts'),error:d.get('error')??null}))});
  }));
  app.post('/rooms/:roomId/feedback',authenticate,member,wrap(async(req,res)=>{
    const own=await root(req.params.roomId).collection('members').doc(req.ctx.uid).get(),room=await root(req.params.roomId).get();
    if(!room.get('endedAt'))throw new HttpError(409,'not_ended','終了後に作成できます');
    const uid=req.ctx.role==='host'?parse(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),req.body?.uid):req.ctx.uid;
    const target=uid===req.ctx.uid?own:await root(req.params.roomId).collection('members').doc(uid).get();
    if(target.get('role')!=='participant'||target.get('status')!=='active')throw new HttpError(403,'not_member','参加者を確認してください');
    const jobId=await jobs.enqueue(req.params.roomId,'participant',target.get('group'),uid);res.status(202).json({jobId});
  }));
  app.get('/rooms/:roomId/feedback/:uid',authenticate,member,wrap(async(req,res)=>{
    const uid=parse(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),req.params.uid),ref=root(req.params.roomId),room=await ref.get();
    if(req.ctx.role!=='host'&&(uid!==req.ctx.uid||!room.get('resultsPublished')))throw new HttpError(403,'not_published','本人の公開済み結果だけ閲覧できます');
    const data=await ref.collection('participantFeedback').doc(uid).get();if(!data.exists){
      const evidence=await ref.collection('transcripts').where('ownerUid','==',uid).limit(1).get();
      if(room.get('endedAt')&&evidence.empty){res.json({source:'none',evidenceCount:0,observations:[],nextSteps:[]});return;}
      throw new HttpError(404,'feedback_pending','まだ分析されていません');
    }res.json(data.data());
  }));
  app.post('/rooms/:roomId/review',authenticate,member,host,wrap(async(req,res)=>{res.status(202).json({jobId:await jobs.enqueue(req.params.roomId,'session')});}));
  app.post('/rooms/:roomId/delete',authenticate,member,host,wrap(async(req,res)=>{
    const room=await root(req.params.roomId).get();if(!room.get('endedAt')&&room.get('phase')!=='closed')throw new HttpError(409,'not_ended','終了したセッションだけ削除できます');
    parse(z.object({confirm:z.literal(true)}).strict(),req.body);await deleteDiscussion(deps,req.params.roomId);res.json({ok:true});
  }));
}
