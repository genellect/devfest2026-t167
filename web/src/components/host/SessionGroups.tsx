"use client";
import { useEffect, useRef, useState } from "react";
import { SpeakingRates, type SpeakingState } from "@/components/Speaking";
import { useRoomFeed } from "@/lib/room-stream";
import { useDoc, useGroups, type LiveGroupOverview, type Member, type Room } from "@/lib/room";
import { GeminiLabel } from "@/components/GeminiLabel";
import { SpeechBars } from "./SessionCharts";

export function SessionGroups({ roomId, room, members, dashboard = false }: { roomId: string; room: Room; members: Member[]; dashboard?: boolean }) {
  const configs = useGroups(roomId);
  const overview = useDoc<LiveGroupOverview>(dashboard ? `sessions/${roomId}/results/live-groups` : undefined).data;
  const speaking = (useRoomFeed(roomId).collections[`sessions/${roomId}/speaking`] ?? []) as unknown as SpeakingState[];
  const [selected, setSelected] = useState<number>();
  const detail = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (selected != null) detail.current?.showModal(); }, [selected]);
  const labels = { opinions: "準備中", discussing: "議論中", consensus: "結論を入力中", done: "終了" };
  function groupData(group: number) {
    const config = configs.find(c => c.number === group), state = room.groupState?.[String(group)];
    const people = members.filter(m => m.group === group).flatMap(m => m.attendees?.length ? m.attendees.map(p => ({ ...p, id: `${m.id}/${p.id}` })) : [{ id: m.id, displayName: m.displayName || "表示名の入力待ち", voiceRegistered: m.ready === true }]);
    return { config, state, people, name: config?.name || `グループ${group}`, voice: speaking.find(s => s.group === group),
      label: room.endedAt || room.phase === "closed" ? "終了" : room.phase === "collecting" ? "準備中" : labels[state?.status ?? "discussing"] };
  }
  const current = selected != null ? groupData(selected) : undefined;
  const names = (people: { id: string; displayName: string }[]) => <div className="session-group-card__people" aria-label="参加者名">{people.length ? people.map(p => <span key={p.id}>{p.displayName}</span>) : <p className="t-note">参加を待っています</p>}</div>;
  return <section className="session-groups" data-dashboard={dashboard || undefined} aria-labelledby="session-groups-title">
    <div className="heading-row"><div><h2 id="session-groups-title" className="t-md">グループの状況</h2>{dashboard && <p className="t-note">カードを押すと詳細を表示</p>}</div><span className="t-note">{room.groups ?? 1}グループ</span></div>
    <div className="session-group-grid">
      {Array.from({ length: room.groups ?? 1 }, (_, i) => i + 1).map(group => {
        const { config, state, people, name, label, voice } = groupData(group);
        const content = <>
          <div className="heading-row"><h3 className="t-sm">{name}</h3><span className="pill">{label}</span></div>
          {names(people)}
          {dashboard && <div className="session-group-focus"><GeminiLabel source={overview?.source} label="議論の軸" />{overview?.groups.find(g => g.group === group) ? <><p className="session-group-focus__title">{overview.groups.find(g => g.group === group)!.focus}</p><ul>{overview.groups.find(g => g.group === group)!.points.map(point => <li key={point}>{point}</li>)}</ul></> : <p className="t-note">共有メモの分析待ち</p>}</div>}
          {dashboard ? room.recording === false && !voice ? <p className="t-note">共有メモで議論を記録しています。</p> : <SpeechBars state={voice} names={people.map(p => p.displayName)} /> : <dl className="session-group-card__stats">
            <div><dt>声の登録</dt><dd>{people.filter(p => p.voiceRegistered).length}<small>/{people.length}</small></dd></div>
            <div><dt>事前意見</dt><dd>{state?.opinions ?? 0}<small>/{state?.total ?? members.filter(m => m.group === group).length}</small></dd></div>
          </dl>}
          <p className="t-note session-group-card__recorder">{room.recording === false ? "録音なし" : `録音担当：${config?.recorderName ? `${config.recorderName}さん` : "未指定"}`}</p>
          {state?.recording?.status && <p className="t-note">録音の分析：{{ analyzing: "分析中", done: "完了", failed: "再送が必要" }[state.recording.status]}</p>}
          {dashboard && <span className="session-group-card__more">詳細を見る</span>}
        </>;
        return <article className="session-group-card" key={group} aria-label={name} data-dashboard={dashboard || undefined}>
          {dashboard ? <button className="session-group-card__open" aria-label={`${name}の詳細`} aria-haspopup="dialog" onClick={() => setSelected(group)}>{content}</button> : content}
        </article>;
      })}
    </div>
    {members.some(m => !m.group) && <div className="session-group-unassigned"><p className="t-note">グループの割り当て待ち</p>{names(members.filter(m => !m.group).flatMap(m => m.attendees?.length ? m.attendees.map(p => ({ ...p, id: `${m.id}/${p.id}` })) : [{ id: m.id, displayName: m.displayName || "表示名の入力待ち" }]))}</div>}
    <dialog ref={detail} className="dialog session-group-sheet" aria-labelledby="group-detail-title" onClose={() => setSelected(undefined)} onClick={e => { if (e.target === detail.current) detail.current?.close(); }}>
      <div className="session-group-sheet__handle" aria-hidden="true" />
      <div className="dialog__head"><div><p className="t-note">グループの詳細</p><h2 id="group-detail-title" className="t-md">{current?.name}</h2></div><button className="btn btn--small" onClick={() => detail.current?.close()}>閉じる</button></div>
      {current && <div className="session-group-sheet__body">
        <section><h3 className="t-label">参加者</h3>{names(current.people)}</section>
        <div className="session-group-sheet__status"><span className="pill">{current.label}</span><p className="t-note">{room.recording === false ? "録音なし" : `録音担当：${current.config?.recorderName || "未指定"}`}</p></div>
        {current.voice ? <SpeakingRates state={current.voice} /> : <div className="session-group-sheet__empty"><h3 className="t-sm">{room.recording === false ? "録音なし" : "発言の集計待ち"}</h3><p className="t-note">{room.recording === false ? "このセッションでは、発言時間を集計しません。" : "録音が始まると、参加者ごとの発言時間と推移が表示されます。"}</p></div>}
        <p className="t-note">事前意見の提出 {current.state?.opinions ?? 0}/{current.state?.total ?? members.filter(m => m.group === selected).length}</p>
      </div>}
    </dialog>
  </section>;
}
