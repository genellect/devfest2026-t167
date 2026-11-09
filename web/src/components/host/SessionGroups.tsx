"use client";
import { useGroups, type Member, type Room } from "@/lib/room";

export function SessionGroups({ roomId, room, members }: { roomId: string; room: Room; members: Member[] }) {
  const configs = useGroups(roomId);
  const labels = { opinions: "準備中", discussing: "議論中", consensus: "結論を入力中", done: "終了" };
  return <section className="session-groups" aria-labelledby="session-groups-title">
    <div className="heading-row"><h2 id="session-groups-title" className="t-md">グループの状況</h2><span className="t-note">{room.groups ?? 1}グループ</span></div>
    <div className="session-group-grid">
      {Array.from({ length: room.groups ?? 1 }, (_, i) => i + 1).map(group => {
        const config = configs.find(c => c.number === group), state = room.groupState?.[String(group)];
        const people = members.filter(m => m.group === group).flatMap(m => m.attendees?.length ? m.attendees : [{ id: m.id, displayName: m.displayName || "表示名の入力待ち", voiceRegistered: m.ready === true }]);
        const registered = people.filter(p => p.voiceRegistered).length;
        const label = room.endedAt || room.phase === "closed" ? "終了" : room.phase === "collecting" ? "準備中" : labels[state?.status ?? "discussing"];
        return <article className="session-group-card" key={group} aria-label={config?.name || `グループ${group}`}>
          <div className="heading-row"><h3 className="t-sm">{config?.name || `グループ${group}`}</h3><span className="pill">{label}</span></div>
          <dl className="session-group-card__stats">
            <div><dt>参加者</dt><dd>{people.length}<small>人</small></dd></div>
            <div><dt>声の登録</dt><dd>{registered}<small>/{people.length}人</small></dd></div>
            <div><dt>{room.endedAt ? "結論の提出" : "事前意見"}</dt><dd>{room.endedAt ? state?.submitted ?? 0 : state?.opinions ?? 0}<small>/{state?.total ?? members.filter(m => m.group === group).length}人</small></dd></div>
          </dl>
          <div className="session-group-card__people">{people.length ? people.map(p => <span key={p.id}>{p.displayName}</span>) : <p className="t-note">参加を待っています</p>}</div>
          <p className="t-note">{room.recording === false ? "録音なし" : `録音担当：${config?.recorderName ? `${config.recorderName}さん` : "未指定"}`}</p>
          {state?.recording?.status && <p className="t-note">録音の分析：{{ analyzing: "分析中", done: "完了", failed: "再送が必要" }[state.recording.status]}</p>}
        </article>;
      })}
    </div>
    {members.some(m => !m.group) && <p className="t-note">所属待ち：{members.filter(m => !m.group).length}端末</p>}
  </section>;
}
