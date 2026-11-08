"use client";
import { useEffect, useState } from 'react';
import { useDoc } from '@/lib/room';
import { sessionRequest } from '@/lib/session';
import { SourceTag } from '@/components/ui';
interface Review {source:string;evidenceCount:number;observations:{evidenceId:string;text:string}[];nextSteps:{evidenceId:string;text:string}[]}
function ReviewView({review,title}:{review:Review|null;title:string}){
  return <section className="box pad stack"><h3>{title} {review && review.source !== "none" && <SourceTag source={review.source}/>}</h3>{review?.evidenceCount ? <>
    <h4>発言から読み取れたこと</h4><ul>{review.observations.map((row,i)=><li key={i}>{row.text}</li>)}</ul>
    <h4>次に試すこと</h4><ul>{review.nextSteps.map((row,i)=><li key={i}>{row.text}</li>)}</ul>
  </> : <p>根拠となる発言が届くと表示します。話者が不明な発言から個人の評価は行いません。</p>}</section>;
}
export function GroupEvidence({roomId,group}:{roomId:string;group:number}){
  const review=useDoc<Review>(`sessions/${roomId}/results/review-g${group}`).data;
  return <ReviewView review={review??null} title="音声内容の振り返り"/>;
}
export function SessionEvidence({roomId}:{roomId:string}){
  const review=useDoc<Review>(`sessions/${roomId}/results/session-review`).data;
  return <ReviewView review={review??null} title="セッション全体の振り返り"/>;
}
export function PersonalEvidence({roomId,uid,published}:{roomId:string;uid:string;published:boolean}){
  const [review,setReview]=useState<Review|null>(null),[error,setError]=useState('');
  useEffect(()=>{
    setReview(null);setError('');if(!published)return;
    let alive=true;
    const load=async()=>{if(document.hidden)return;try{const data=await sessionRequest<Review>(`/rooms/${roomId}/feedback/${uid}`);if(alive){setReview(data);setError('');}}catch{if(alive){setReview(null);setError('振り返りを準備しています。');}}};
    void load();const timer=setInterval(()=>void load(),10000);return()=>{alive=false;clearInterval(timer);};
  },[roomId,uid,published]);
  if(!published)return null;
  return <>{error&&<p role="status">{error}</p>}<ReviewView review={review} title="あなたの振り返り"/></>;
}

export function ProcessingStatus({roomId}:{roomId:string}){
  const [jobs,setJobs]=useState<{id:string;status:string;kind:string}[]>([]),[error,setError]=useState('');
  useEffect(()=>{
    let alive=true;const load=async()=>{if(document.hidden)return;try{const data=await sessionRequest<{jobs:typeof jobs}>(`/rooms/${roomId}/processing`);if(alive){setJobs(data.jobs);setError('');if(data.jobs.some(job=>job.status==='queued'))void sessionRequest(`/rooms/${roomId}/processing/run`,'POST',{}).catch(()=>{});}}catch{if(alive)setError('分析の接続を確認できません。');}};
    void load();const timer=setInterval(()=>void load(),10000);return()=>{alive=false;clearInterval(timer);};
  },[roomId]);
  if(!jobs.length&&!error)return null;
  return <section className="box pad stack" aria-label="音声分析の処理状況"><h3>音声分析の処理状況</h3>{error&&<p role="alert">{error}</p>}
    {jobs.some(j=>j.status!=='failed')&&<p role="status">音声から内容を分析しています。</p>}
    {jobs.filter(j=>j.status==='failed').map(job=><div key={job.id}><p>分析を完了できませんでした。</p><button type="button" className="btn" onClick={async()=>{try{await sessionRequest(`/rooms/${roomId}/processing/${job.id}/retry`,'POST',{});setJobs(previous=>previous.map(j=>j.id===job.id?{...j,status:'queued'}:j));setError('');}catch{setError('再試行できませんでした。接続と最新の処理を確認してください。');}}}>分析を再試行</button></div>)}
  </section>;
}
