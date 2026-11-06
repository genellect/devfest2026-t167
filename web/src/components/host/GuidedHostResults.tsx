"use client";
import Link from "next/link";
import { useDoc, type Flow, type Room } from "@/lib/room";
interface Aggregate { analyzedGroups: number; totalGroups: number; totalMinutes: number; good: { group: number; text: string }[]; review: { group: number; text: string }[]; source: string }
export function GuidedHostResults({ roomId, room }: { roomId: string; room: Room }) {
  const summary = useDoc<Aggregate>(`sessions/${roomId}/results/session-summary`).data;
  return <div className="body"><section className="box pad-lg stack"><h2>セッション全体の結果</h2><p>分析済み {summary?.analyzedGroups ?? 0}/{room.groups ?? 1}グループ</p><p>グループごとの分析結果を集計しています。未分析のグループは含めません。</p>
    {summary?.good.map((p, i) => <p key={i}>グループ{p.group}：{p.text}</p>)}
    {summary?.review.map((p, i) => <p key={i}>振り返り・グループ{p.group}：{p.text}</p>)}
    <p>{summary?.source === "mock" ? "デモデータ" : "AIによる分析結果の集計"}</p><Link className="btn btn--blue" href="/home">ホームに戻る</Link>
  </section>{Array.from({ length: room.groups ?? 1 }, (_, i) => <Group key={i} roomId={roomId} group={i + 1} />)}</div>;
}
function Group({ roomId, group }: { roomId: string; group: number }) {
  const flow = useDoc<Flow>(`sessions/${roomId}/results/flow-g${group}`).data;
  return <section className="box pad-lg stack"><h3>グループ{group}の分析結果</h3>{flow ? <><p>{flow.flowNote}</p>{flow.good.map((p, i) => <p key={i}>よかった点：{p.text}</p>)}{flow.review.map((p, i) => <p key={i}>振り返り：{p.text}</p>)}</> : <p>録音の送信・分析を待っています。録音しなかったグループの分析結果はありません。</p>}</section>;
}
