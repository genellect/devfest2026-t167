"use client";
import { useEffect, useState } from "react";
import { ApiError, callApi } from "@/lib/api";
import { useMembers, useGroups, type Room } from "@/lib/room";
/** ホストのセッション設定。embedded はホスト画面の設定ダイアログに入れるとき（開始ボタンと折りたたみを出さない） */
export function SessionSettings({ roomId, room, embedded = false }: { roomId: string; room: Room; embedded?: boolean }) {
  const [view, setView] = useState(room.participantView ?? { theme: true, timer: true, members: true, speaking: false });
  useEffect(() => setView(room.participantView ?? { theme: true, timer: true, members: true, speaking: false }), [room.participantView]);
  const [published, setPublished] = useState(room.resultsPublished ?? false);
  useEffect(() => setPublished(room.resultsPublished ?? false), [room.resultsPublished]);
  const [publishOnEnd, setPublishOnEnd] = useState(room.publishOnEnd ?? true);
  useEffect(() => setPublishOnEnd(room.publishOnEnd ?? true), [room.publishOnEnd]);
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
  async function changePublished(checked: boolean) {
    const before = published; setPublished(checked);
    if (!await act("settings", { resultsPublished: checked })) setPublished(before);
  }
  async function changePublishOnEnd(checked: boolean) {
    const before = publishOnEnd; setPublishOnEnd(checked);
    if (!await act("settings", { publishOnEnd: checked })) setPublishOnEnd(before);
  }
  const who = (m: (typeof members)[number], i: number) => m.attendees?.map((a) => a.displayName).join("、") || m.displayName || `参加者${i + 1}`;
  const voice = (m: (typeof members)[number]) => (m.ready ? "声：登録済み" : "声：未登録");
  const many = (room.groups ?? 1) > 1;
  const viewKeys = ["theme", "timer", "members", "speaking"] as const;
  const viewLabel = { theme: "テーマ", timer: room.minutes ? "残り時間" : "経過時間", members: "所属グループの参加者", speaking: "所属グループの発言時間の推定" } as const;
  const content = <div className="stack settings">
    <section className="settings__group" aria-labelledby="set-theme">
      <h3 id="set-theme" className="t-sm">テーマ</h3>
      <form className="stack stack--tight" key={`${room.title}-${room.theme}`} onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const theme = String(f.get("theme") ?? "").trim(); void act("settings", { title: (theme || room.title).slice(0, 100), theme }); }}>
        <label className="sr-only" htmlFor="set-theme-input">テーマ</label>
        <input id="set-theme-input" className="input" name="theme" defaultValue={room.theme ?? ""} maxLength={1000} disabled={room.phase === "closed"} />
        <button className="btn" disabled={busy || room.phase === "closed"}>テーマを保存</button>
      </form>
    </section>
    <section className="settings__group" aria-labelledby="set-publish">
      <h3 id="set-publish" className="t-sm">結果の公開</h3>
      <label className="check"><input type="checkbox" checked={published} disabled={busy} onChange={(e) => void changePublished(e.target.checked)} /><span>所属グループの分析結果を参加者に公開する</span></label>
      <label className="check"><input type="checkbox" checked={publishOnEnd} disabled={busy} onChange={(e) => void changePublishOnEnd(e.target.checked)} /><span>終了時に所属グループの結果を自動公開する</span></label>
    </section>
    <section className="settings__group" aria-labelledby="set-view">
      <h3 id="set-view" className="t-sm">参加者の画面に出すもの</h3>
      {viewKeys.map((key) => <label className="check" key={key}><input type="checkbox" disabled={busy} checked={view[key] ?? (key !== "speaking")} onChange={(e) => void changeView(key, e.target.checked)} /><span>参加者に{viewLabel[key]}を表示</span></label>)}
    </section>
    {!embedded && room.phase === "collecting" && <>
      <button className="btn btn--blue" disabled={busy} onClick={() => void start()}>セッションを開始</button>
      {notReady && <div className="notice notice--warn stack" role="alert"><p>{notReady}。外した参加者は、このセッションに参加できなくなります。</p>
        <button className="btn btn--blue" disabled={busy} onClick={() => void start(true)}>未準備の参加者を外して開始</button></div>}
    </>}
    {(many || !embedded) && <section className="settings__group" aria-labelledby="set-members">
      <h3 id="set-members" className="t-sm">参加者の所属</h3>
      {!members.length && <p className="t-note">まだ参加者がいません。</p>}
      {members.map((m, i) => <div className="field" key={m.id}>
        <label className="field__label" htmlFor={`member-${m.id}`}>{who(m, i)}（{voice(m)}）</label>
        <select id={`member-${m.id}`} aria-label={`参加者${i + 1}のグループ`} disabled={busy || room.phase === "closed"} value={m.group ?? ""} onChange={(e) => void act("groups/assign", { uid: m.id, group: Number(e.target.value) })}><option value="" disabled>未割り当て</option>{Array.from({ length: room.groups ?? 1 }, (_, g) => <option key={g} value={g + 1}>グループ{g + 1}</option>)}</select>
      </div>)}
    </section>}
    <section className="settings__group" aria-labelledby="set-recorder">
      <h3 id="set-recorder" className="t-sm">録音を担当する端末</h3>
      {Array.from({ length: room.groups ?? 1 }, (_, i) => i + 1).map((g) => {
        const config = configurations.find((c) => c.number === g);
        return <form className="stack stack--tight" key={`${g}-${config?.name}-${config?.recorderUid}`} onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void act("groups/update", { group: g, name: f.get("name") || config?.name || `グループ${g}`, recorderUid: f.get("recorder") || null }); }}>
          {many && <div className="field"><label className="field__label" htmlFor={`group-name-${g}`}>グループ{g}の名前</label><input id={`group-name-${g}`} className="input" name="name" defaultValue={config?.name ?? `グループ${g}`} maxLength={60} required /></div>}
          <div className="field"><label className="field__label" htmlFor={`recorder-${g}`}>グループ{g}の録音担当</label><select id={`recorder-${g}`} name="recorder" defaultValue={config?.recorderUid ?? ""}><option value="">グループ内の任意の端末1台</option>{members.filter((m) => m.group === g).map((m, i) => <option key={m.id} value={m.id}>{who(m, i)}（{voice(m)}）</option>)}</select></div>
          <button className="btn" disabled={busy || room.phase === "closed"}>グループ{g}を保存</button>
        </form>;
      })}
    </section>
    {message && <p className="notice" role="status">{message}</p>}
  </div>;
  return embedded ? content : <details className="box mvp-settings"><summary>セッション設定・グループ管理</summary>{content}</details>;
}
