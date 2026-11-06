"use client";
import { useEffect, useState } from "react";
import { ApiError, callApi } from "@/lib/api";
import { useMembers, useGroups, type Room } from "@/lib/room";
export function SessionSettings({ roomId, room }: { roomId: string; room: Room }) {
  const [view, setView] = useState(room.participantView ?? { theme: true, timer: true, members: true, speaking: false });
  useEffect(() => setView(room.participantView ?? { theme: true, timer: true, members: true, speaking: false }), [room.participantView]);
  const [published, setPublished] = useState(room.resultsPublished ?? false);
  useEffect(() => setPublished(room.resultsPublished ?? false), [room.resultsPublished]);
  const configurations = useGroups(roomId);
  const members = useMembers(roomId, true).filter((m) => m.role === "participant" && m.status !== "inactive");
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  async function act(path: string, data: object) { setBusy(true); setMessage(""); try { await callApi(`/rooms/${roomId}/${path}`, data); setMessage("保存しました。"); return true; } catch (e) { setMessage((e as Error).message); return false; } finally { setBusy(false); } }
  // 未準備のGuestがいると開始できない。Hostが人数を確かめたうえで、外して始められるようにする
  const [notReady, setNotReady] = useState("");
  async function start(excludeNotReady = false) {
    setBusy(true); setMessage(""); setNotReady("");
    try { await callApi(`/rooms/${roomId}/phase`, { to: "discussing", ...(excludeNotReady ? { excludeNotReady } : {}) }); }
    catch (e) { if (e instanceof ApiError && e.code === "guests_not_ready") setNotReady(e.message); else setMessage((e as Error).message); }
    finally { setBusy(false); }
  }
  async function changeView(key: "theme" | "timer" | "members" | "speaking", checked: boolean) {
    const before = view, next = { ...view, [key]: checked }; setView(next);
    if (!await act("settings", { participantView: next })) setView(before);
  }
  return <details className="box mvp-settings"><summary>セッション設定・グループ管理</summary>
    <div className="stack">
      <form className="stack" key={`${room.title}-${room.theme}-${room.minutes}`} onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void act("settings", { title: f.get("title"), theme: f.get("theme"), minutes: Number(f.get("minutes")), groupSelection: f.get("selection") }); }}>
        <label className="field">セッション名<input name="title" defaultValue={room.title} maxLength={100} required disabled={room.phase === "closed"} /></label>
        <label className="field">テーマ<input name="theme" defaultValue={room.theme ?? ""} maxLength={1000} disabled={room.phase === "closed"} /></label>
        <label className="field">制限時間（分）<input name="minutes" type="number" min={1} max={180} defaultValue={room.minutes ?? 15} disabled={room.phase === "closed"} /></label>
        <label className="field">所属方法<select name="selection" defaultValue={room.groupSelection ?? "participant"} disabled={room.phase === "closed"}><option value="participant">参加者が選択</option><option value="host">Hostが割り当て</option></select></label>
        <button className="btn" disabled={busy || room.phase === "closed"}>セッション設定を保存</button>
      </form>
      <label><input type="checkbox" checked={published} disabled={busy} onChange={(e) => { setPublished(e.target.checked); void act("settings", { resultsPublished: e.target.checked }); }} />所属グループの分析結果を参加者に公開する</label>
      {room.phase === "collecting" && <>
        <button className="btn" disabled={busy || (room.groups ?? 1) >= 12} onClick={() => void act("groups/create", { name: `グループ${(room.groups ?? 1) + 1}` })}>グループを追加</button>
        <button className="btn" disabled={busy || (room.groups ?? 1) <= 1} onClick={() => void act("groups/delete", { group: room.groups })}>最後の空グループを削除</button>
        <button className="btn btn--blue" disabled={busy} onClick={() => void start()}>セッションを開始</button>
        {notReady && <div className="notice notice--warn stack" role="alert"><p>{notReady}。外したGuestは、このセッションに参加できなくなります。</p>
          <button className="btn btn--blue" disabled={busy} onClick={() => void start(true)}>未準備のGuestを外して開始</button></div>}
      </>}
      <label><input type="checkbox" checked={room.publishOnEnd ?? true} onChange={(e) => void act("settings", { publishOnEnd: e.target.checked })} />終了時に所属グループの結果を自動公開する</label>
      {(["theme", "timer", "members", "speaking"] as const).map((key, i) => <label key={key}><input type="checkbox" disabled={busy} checked={view[key] ?? (key !== "speaking")} onChange={(e) => void changeView(key, e.target.checked)} />Guestに{["テーマ", "残り時間", "所属グループの参加者", "所属グループの発言時間の推定"][i]}を表示</label>)}
      <h3>参加者の所属</h3>
      {!members.length && <p>まだ参加者がいません。</p>}
      {members.map((m, i) => <label className="field" key={m.id}>{m.attendees?.map((a) => a.displayName).join("、") || m.displayName || `参加者${i + 1}`}（{m.ready ? "準備完了" : "登録中"}）<select aria-label={`参加者${i + 1}のグループ`} disabled={busy || room.phase === "closed"} value={m.group ?? ""} onChange={(e) => void act("groups/assign", { uid: m.id, group: Number(e.target.value) })}><option value="" disabled>未割り当て</option>{Array.from({ length: room.groups ?? 1 }, (_, i) => <option key={i} value={i + 1}>グループ{i + 1}</option>)}</select></label>)}
      <h3>グループ名・録音の許可</h3>
      {Array.from({ length: room.groups ?? 1 }, (_, i) => i + 1).map((g) => <form className="stack" key={`${g}-${configurations.find((c) => c.number === g)?.name}-${configurations.find((c) => c.number === g)?.recorderUid}`} onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void act("groups/update", { group: g, name: f.get("name"), recorderUid: f.get("recorder") || null }); }}>
        <label className="field">グループ{g}の名前<input name="name" defaultValue={configurations.find((c) => c.number === g)?.name ?? `グループ${g}`} maxLength={60} required /></label>
        <label className="field">グループ{g}の録音担当<select name="recorder" defaultValue={configurations.find((c) => c.number === g)?.recorderUid ?? ""}><option value="">グループ内の任意の端末1台</option>{members.filter((m) => m.group === g).map((m, i) => <option key={m.id} value={m.id}>{m.attendees?.map((a) => a.displayName).join("、") || m.displayName || `参加者${i + 1}`}（{m.ready ? "準備完了" : "登録中"}）</option>)}</select></label>
        <button className="btn" disabled={busy || room.phase === "closed"}>グループ{g}を保存</button>
      </form>)}
      {message && <p role="status">{message}</p>}
    </div>
  </details>;
}
