"use client";
import { AppShell } from "@/components/shell";
import Link from "next/link";
import { Presentation, Settings } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { useGeminiSource } from "@/components/ui";
import { ApiError, callApi } from "@/lib/api";
import { millis, useDoc, useGroupResults, useInsights, useMembers, type Flow, type GroupPoints, type Room, type Summary } from "@/lib/room";
import { ClassResult, ConsensusProgress, GroupResultView } from "./HostRoom";
import { LiveBoard } from "./LiveBoard";
import { HostSpeaking } from "@/components/Speaking";
import { SessionSettings } from "./SessionSettings";

/**
 * 教員の画面（1本化した流れ）。段階ごとに主役を1つにする（Docs「UIフィードバック」）。
 * 準備中：参加コードとQR・参加人数・事前意見の提出数・開始／議論中：次に話すとよい論点と3つの数字（LiveBoard）／
 * 終了後：結論の一文の回収・結果。設定は歯車のボタンで開くダイアログに置く。
 */
export function TeacherRoom({ roomId, room }: { roomId: string; room: Room }) {
  const source = useGeminiSource();
  const members = useMembers(roomId, true).filter((m) => m.role === "participant" && m.status !== "inactive");
  const results = useGroupResults(roomId, true);
  const insights = useInsights(roomId, true, false);
  const ended = !!room.endedAt || room.phase === "closed";
  const summary = useDoc<Summary>(ended ? `sessions/${roomId}/results/summary` : undefined).data;
  const [openGroup, setOpenGroup] = useState<number>();
  const settings = useRef<HTMLDialogElement>(null);
  const state = room.phase === "collecting" ? "準備中" : ended ? "終了" : "議論中";
  const seats = members.reduce((n, m) => n + (m.attendees?.length || 1), 0);
  const opinions = Object.values(room.groupState ?? {}).reduce((n, g) => n + (g.opinions ?? 0), 0);

  // 時間切れの終了は、時間を設定したセッションだけ（設定しない既定では教員が終える）
  useEffect(() => {
    if (!room.endsAt || ended || room.phase !== "discussing") return;
    const left = millis(room.endsAt)! - Date.now();
    const t = setTimeout(() => void callApi(`/rooms/${roomId}/check-time`).catch(() => {}), Math.max(0, left) + 500);
    return () => clearTimeout(t);
  }, [room.endsAt, room.phase, ended, roomId]);

  return (
    <AppShell wide back="/teacher"
      eyebrow={<>{room.className && <span>{room.className}</span>}<span className={`pill pill--${state === "議論中" ? "live" : state === "終了" ? "done" : "ready"}`}>{state}</span></>}
      title={room.theme || room.title}
      actions={<>
        <a className="btn btn--small present-link" href={`/rooms/${roomId}/present`} target="_blank" rel="noopener"><Presentation aria-hidden="true" strokeWidth={1.75} />投影画面</a>
        <button type="button" className="icon-btn" aria-label="設定" title="設定" onClick={() => settings.current?.showModal()}>
          <Settings size={20} strokeWidth={1.75} aria-hidden="true" />
        </button></>}>

      {room.phase === "collecting" && <Lobby roomId={roomId} room={room} seats={seats} opinions={opinions} />}
      {!ended && room.phase !== "collecting" && <LiveBoard roomId={roomId} room={room} members={members} insights={insights} />}
      {ended && (openGroup
        ? <div className="teacher__body"><button className="text-btn" onClick={() => setOpenGroup(undefined)}>セッション全体に戻る</button><GroupResultView result={results.find((r) => r.group === openGroup) ?? null} group={openGroup} roomId={roomId} source={source} /></div>
        : <div className="teacher__body">
          <ConsensusProgress roomId={roomId} room={room} results={results} summary={summary ?? null} />
          <ClassResult roomId={roomId} room={room} results={results} summary={summary ?? null} onOpen={setOpenGroup} />
          <HostSpeaking roomId={roomId} card ended />
          <RecordingReview roomId={roomId} room={room} />
        </div>)}

      <dialog ref={settings} className="dialog" aria-labelledby="settings-title" onClick={(e) => { if (e.target === settings.current) settings.current?.close(); }}>
        <div className="dialog__head"><h2 id="settings-title" className="t-md">設定</h2><button type="button" className="btn btn--small" onClick={() => settings.current?.close()}>閉じる</button></div>
        <SessionSettings roomId={roomId} room={room} embedded />
      </dialog>
    </AppShell>
  );
}

/** 準備中：教室に映す参加コードとQR、集まり具合、開始 */
function Lobby({ roomId, room, seats, opinions }: { roomId: string; room: Room; seats: number; opinions: number }) {
  const [qr, setQr] = useState<string>();
  const code = room.joinCode ?? "";
  useEffect(() => {
    if (!code) return;
    QRCode.toDataURL(`${window.location.origin}/join?code=${code}`, { margin: 1, width: 520 }).then(setQr).catch(() => setQr(undefined));
  }, [code]);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [notReady, setNotReady] = useState("");
  async function start(excludeNotReady = false) {
    setBusy(true); setMessage(""); setNotReady("");
    try { await callApi(`/rooms/${roomId}/phase`, { to: "discussing", ...(excludeNotReady ? { excludeNotReady } : {}) }); }
    catch (e) { if (e instanceof ApiError && e.code === "guests_not_ready") setNotReady(e.message); else setMessage((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <div className="teacher__body lobby">
      <section className="lobby__code" aria-label="参加コード">
        <p className="lobby__label">参加コード</p>
        <p data-testid="join-code" className="lobby__digits" aria-label={code.split("").join(" ")}>{code.length === 6 ? <>{code.slice(0, 3)}<span aria-hidden="true"> </span>{code.slice(3)}</> : code}</p>
        {qr
          // eslint-disable-next-line @next/next/no-img-element
          ? <img className="lobby__qr" src={qr} alt={`参加用のQRコード（参加コード ${code}）`} />
          : <div className="lobby__qr" aria-hidden="true" />}
        <p className="t-note">スマホで QR を読み取るか、6桁の数字を入力します。</p>
      </section>
      <section className="lobby__side" aria-label="集まり具合">
        <dl className="stats">
          <div><dt>参加</dt><dd>{seats}人</dd></div>
          <div><dt>事前意見</dt><dd>{opinions}/{seats}人</dd></div>
        </dl>
        {notReady && <div className="notice notice--warn stack" role="alert"><p>{notReady}。外した参加者は、このセッションに参加できなくなります。</p>
          <button className="btn btn--blue" disabled={busy} onClick={() => void start(true)}>未準備の参加者を外して開始</button></div>}
        {message && <p className="notice notice--error" role="alert">{message}</p>}
        <button className="btn btn--blue btn--block start-btn" disabled={busy} onClick={() => void start()}>{busy ? "開始しています…" : "議論を開始"}</button>
        <p className="t-note">開始したあとも、同じ参加コードで途中から参加できます。</p>
      </section>
    </div>
  );
}

interface SessionSummary { analyzedGroups: number; good: { group: number; text: string }[]; review: { group: number; text: string }[]; source: string }

/** 終了後：録音の分析から、議論の進め方の振り返り（録音しなかったグループは出ない） */
function RecordingReview({ roomId, room }: { roomId: string; room: Room }) {
  const summary = useDoc<SessionSummary>(`sessions/${roomId}/results/session-summary`).data;
  const groups = Array.from({ length: room.groups ?? 1 }, (_, i) => i + 1);
  return (
    <section className="flow-card stack" aria-labelledby="review-title">
      <div className="heading-row"><h2 id="review-title" className="t-sm">録音の振り返り</h2></div>
      <p className="t-note">分析済み {summary?.analyzedGroups ?? 0}/{room.groups ?? 1}グループ</p>
      {groups.map((g) => <ReviewGroup key={g} roomId={roomId} group={g} />)}
      <Link className="btn btn--blue" href="/teacher" style={{ alignSelf: "flex-start" }}>ホームに戻る</Link>
    </section>
  );
}
function ReviewGroup({ roomId, group }: { roomId: string; group: number }) {
  const flow = useDoc<Flow>(`sessions/${roomId}/results/flow-g${group}`).data;
  const points = useDoc<GroupPoints>(`sessions/${roomId}/results/points-g${group}`).data?.points ?? [];
  const missed = points.filter((p) => !p.discussed);
  return (
    <div className="review-group">
      <h3 className="t-label">グループ{group}</h3>
      {flow ? <>
        <p>{flow.flowNote}</p>
        {!!points.length && <>
          <p className="t-note">事前の意見の論点 {points.length}件のうち、議論で話されたのは {points.length - missed.length}件（録音から判定）</p>
          {!!missed.length && <ul className="review-list" aria-label="話されなかった論点">{missed.map((p, i) => <li key={i}><span className="pill tag--yellow">話されなかった論点</span>{p.summary}</li>)}</ul>}
        </>}
        {!!flow.good.length && <ul className="review-list">{flow.good.map((p, i) => <li key={i}><span className="pill pill--live">よかった点</span>{p.text}</li>)}</ul>}
        {!!flow.review.length && <ul className="review-list">{flow.review.map((p, i) => <li key={i}><span className="pill">次に試すこと</span>{p.text}</li>)}</ul>}
      </> : <p className="t-note">録音の送信・分析を待っています。録音しなかったグループには振り返りがありません。</p>}
    </div>
  );
}
