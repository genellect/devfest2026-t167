"use client";
import { useDoc } from '@/lib/room';
import { useRoomFeed } from '@/lib/room-stream';
import { useEffect, useRef, useState } from 'react';
import { SpeakingTimeline, type SpeakingMinute } from '@/components/SpeakingTimeline';
export interface SpeakingState {
  group: number; source: 'mock' | 'model'; mode?: 'identified' | 'anonymous'; version?: string; processedMs: number; unknownMs: number;
  talkMs: Record<string, number>; members: { uid: string; label: string }[];
  latest: { uid: string | null; label: string; confidence: number | null } | null;
  timeline?: SpeakingMinute[];
}
/** 終了後に参加者へ届く、本人だけの集計（サーバーがほかの人の名前と時間を外して送る） */
export interface SelfSpeaking {
  scope: 'self'; group: number; source: 'mock' | 'model'; processedMs: number; totalMs: number; memberCount: number;
  members: { uid: string; label: string }[]; talkMs: Record<string, number>; timeline: SpeakingMinute[];
}
function SelfSpeakingRates({ state }: { state: SelfSpeaking }) {
  const many = state.members.length > 1;
  return <section className="box pad stack" aria-label="あなたの発言時間">
    <h3>{many ? 'この端末の参加者の発言時間（推定）' : 'あなたの発言時間（推定）'}</h3>
    {state.source === 'mock' && <p>音声モックのテスト表示です。実際の声は識別していません。</p>}
    {!state.members.length ? <p>声を登録していないため、発言時間は推定していません。</p>
      : state.members.map((m) => { const ms = state.talkMs[m.uid] ?? 0; return <div key={m.uid}><span>{many ? `${m.label}：` : ''}{(ms / 1000).toFixed(1)}秒 · グループの発話の{state.totalMs ? `${Math.round(ms / state.totalMs * 100)}%` : 'データなし'}</span><progress aria-label={`${m.label}の発言率`} value={ms} max={state.totalMs || 1} /></div>; })}
    {!!state.members.length && <SpeakingTimeline timeline={state.timeline} members={state.members} processedMs={state.processedMs} self />}
    <p className="t-note">割合の分母は、判別できなかった時間を含むグループ全体の発話時間です。ほかの人の時間は表示しません。多く話すほど良いという意味ではなく、能力・意欲の評価にも使用しません。</p>
  </section>;
}
export function SpeakingRates({ state: incoming, finalized = false }: { state: SpeakingState; finalized?: boolean }) {
  const latest = useRef(incoming);
  const [state, setState] = useState(incoming);
  useEffect(() => {
    latest.current = incoming;
    setState(current => finalized || current.mode !== incoming.mode || current.version !== incoming.version || incoming.processedMs < current.processedMs ? incoming : current);
  }, [incoming, finalized]);
  // 音声は短い区間で処理し、画面への反映は10秒ごと。終了後は確定済み結果をすぐ出す。
  useEffect(() => {
    const timer = setInterval(() => setState(latest.current), 10_000);
    return () => clearInterval(timer);
  }, []);
  const total = Object.values(state.talkMs).reduce((a, b) => a + b, 0) + state.unknownMs;
  return <section className="box pad stack" aria-label={`グループ${state.group}の発言時間`}>
    <h3>グループ{state.group}の発言時間（推定）</h3>
    {state.mode === 'anonymous' && <p className="t-note">声の違いを話者A・B・Cに区分しています。名前とは結び付けません。</p>}
    {state.source === 'model' && <p className="t-note">実音声モデルで発話を分析しています。</p>}
    {state.source === 'mock' && <p>音声モックのテスト表示です。実際の声は識別していません。</p>}
    <p>直近の発言者：{state.latest?.label ?? '発話なし'}</p>
    {state.members.map((m) => <div key={m.uid}><span>{m.label}：{((state.talkMs[m.uid] ?? 0) / 1000).toFixed(1)}秒 · {total ? `${Math.round((state.talkMs[m.uid] ?? 0) / total * 100)}%` : 'データなし'}</span><progress aria-label={`${m.label}の発言率`} value={state.talkMs[m.uid] ?? 0} max={total || 1} /></div>)}
    <p>話者不明：{(state.unknownMs / 1000).toFixed(1)}秒{total ? ` · ${Math.round(state.unknownMs / total * 100)}%` : ''}</p>
    {state.timeline && <SpeakingTimeline timeline={state.timeline} members={state.members} processedMs={state.processedMs} />}
    <p className="t-note">雑音・無音と判定した区間を除いた発話時間からの推定です。短い相づちや同時発話は誤判別し得ます。能力・意欲の評価には使用しません。</p>
  </section>;
}
export function GuestSpeaking({ roomId, group }: { roomId: string; group: number }) {
  const { data } = useDoc<SpeakingState | SelfSpeaking>(`sessions/${roomId}/speaking/${group}`);
  const room = useDoc<{ endedAt?: unknown }>(`sessions/${roomId}`).data;
  if (!data) return null;
  return 'scope' in data && data.scope === 'self' ? <SelfSpeakingRates state={data} /> : <SpeakingRates state={data as SpeakingState} finalized={!!room?.endedAt} />;
}
export function HostSpeaking({ roomId, card = false, ended = false }: { roomId: string; card?: boolean; ended?: boolean }) {
  const groups = useRoomFeed(roomId).collections[`sessions/${roomId}/speaking`] ?? [];
  const room = useDoc<{ endedAt?: unknown }>(`sessions/${roomId}`).data;
  const done = ended || !!room?.endedAt;
  const title = done ? '発言時間と発言率の推移' : 'リアルタイムの発言状況';
  return <section className={card ? "flow-card stack" : "body stack"} aria-label={title}><h2 className={card ? "t-sm" : undefined}>{title}</h2>{!groups.length && <p>{done ? '発言時間の記録はありません。' : '録音担当端末が録音を始めると、発言時間と発言率が表示されます。共有端末では話者A・B・Cに分けます。'}</p>}{groups.map((g) => <SpeakingRates key={g.id} state={g as unknown as SpeakingState} finalized={done} />)}</section>;
}
