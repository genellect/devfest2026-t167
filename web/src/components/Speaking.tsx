"use client";
import { useDoc } from '@/lib/room';
import { useRoomFeed } from '@/lib/room-stream';
export interface SpeakingState {
  group: number; source: 'mock' | 'model'; processedMs: number; unknownMs: number;
  talkMs: Record<string, number>; members: { uid: string; label: string }[];
  latest: { uid: string | null; label: string; confidence: number | null } | null;
}
export function SpeakingRates({ state }: { state: SpeakingState }) {
  const total = Object.values(state.talkMs).reduce((a, b) => a + b, 0) + state.unknownMs;
  return <section className="box pad stack" aria-label={`グループ${state.group}の発言時間`}>
    <h3>グループ{state.group}の発言時間（推定）</h3>
    {state.source === 'model' && <p className="t-note">実音声モデルで照合しています。</p>}
    {state.source === 'mock' && <p>音声モックのテスト表示です。実際の声は識別していません。</p>}
    <p>直近の発言者：{state.latest?.label ?? '発話なし'}</p>
    {state.members.map((m) => <div key={m.uid}><span>{m.label}：{((state.talkMs[m.uid] ?? 0) / 1000).toFixed(1)}秒 · {total ? `${Math.round((state.talkMs[m.uid] ?? 0) / total * 100)}%` : 'データなし'}</span><progress aria-label={`${m.label}の発言率`} value={state.talkMs[m.uid] ?? 0} max={total || 1} /></div>)}
    <p>判別不能：{(state.unknownMs / 1000).toFixed(1)}秒</p>
    <p className="t-note">無音を除いた発話時間からの推定です。短い相づちや同時発話は誤判別し得ます。能力・意欲の評価には使用しません。</p>
  </section>;
}
export function GuestSpeaking({ roomId, group }: { roomId: string; group: number }) {
  const { data } = useDoc<SpeakingState>(`sessions/${roomId}/speaking/${group}`);
  return data ? <SpeakingRates state={data} /> : null;
}
export function HostSpeaking({ roomId, card = false }: { roomId: string; card?: boolean }) {
  const groups = useRoomFeed(roomId).collections[`sessions/${roomId}/speaking`] ?? [];
  return <section className={card ? "flow-card stack" : "body stack"} aria-label="リアルタイムの発言状況"><h2 className={card ? "t-sm" : undefined}>リアルタイムの発言状況</h2>{!groups.length && <p>録音担当端末が録音を始めると、登録した声との照合結果が表示されます。</p>}{groups.map((g) => <SpeakingRates key={g.id} state={g as unknown as SpeakingState} />)}</section>;
}
