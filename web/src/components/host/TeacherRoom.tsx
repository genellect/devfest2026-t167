"use client";
import { MaterialManager } from "@/components/integrations/MaterialManager";
import { SessionEvidence, GroupEvidence, ProcessingStatus } from "@/components/analysis/EvidenceAnalysis";
import { ClassroomRoster } from "@/components/classroom/ClassroomRoster";
import { AppShell } from "@/components/shell";
import { HostSpeaking, type SpeakingState } from "@/components/Speaking";
import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { useGeminiSource } from "@/components/ui";
import { ApiError, callApi } from "@/lib/api";
import { millis, useDoc, useGroupResults, useInsights, useMembers, type Flow, type Room, type Summary } from "@/lib/room";
import { ClassResult, ConsensusProgress, GroupResultView } from "./HostResults";
import { LiveBoard } from "./LiveBoard";
import { GroupDashboard } from "./GroupDashboard";
import { sessionGroups } from "./session-groups";
import { refreshRoomFeed, useRoomFeed } from "@/lib/room-stream";
import { SessionSettings } from "./SessionSettings";

/**
 * 教員の画面（1本化した流れ）。段階ごとに主役を1つにする（Docs「UIフィードバック」）。
 * 準備中：参加コードとQR・参加人数・開始／議論中：次に話すとよい論点と3つの数字（LiveBoard）／
 * 終了後：結論の一文の回収・結果。設定は歯車のボタンで開くダイアログに置く。
 */
export function TeacherRoom({ roomId, room: incomingRoom }: { roomId: string; room: Room }) {
  const [confirmedStart, setConfirmedStart] = useState<string>();
  // APIが開始成功を返した後は、遅延した準備中の配信を待たずにホストも進む。
  const room = confirmedStart === roomId && incomingRoom.phase === "collecting" ? { ...incomingRoom, phase: "discussing" as const } : incomingRoom;
  const source = useGeminiSource();
  const feed = useRoomFeed(roomId);
  const members = useMembers(roomId, true).filter((m) => m.role === "participant" && m.status !== "inactive");
  const results = useGroupResults(roomId, true);
  const insights = useInsights(roomId, true, false);
  const ended = !!room.endedAt || room.phase === "closed";
  const summary = useDoc<Summary>(ended ? `sessions/${roomId}/results/summary` : undefined).data;
  const [openGroup, setOpenGroup] = useState<number>();
  const settings = useRef<HTMLDialogElement>(null);
  const state = room.phase === "collecting" ? "準備中" : ended ? "終了" : "議論中";
  const seats = members.reduce((n, m) => n + (m.attendees?.length || 1), 0);

  // 時間切れの終了は、時間を設定したセッションだけ（設定しない既定では教員が終える）
  useEffect(() => {
    if (!room.endsAt || ended || room.phase !== "discussing") return;
    const left = millis(room.endsAt)! - Date.now();
    const t = setTimeout(() => void callApi(`/rooms/${roomId}/check-time`).catch(() => {}), Math.max(0, left) + 500);
    return () => clearTimeout(t);
  }, [room.endsAt, room.phase, ended, roomId]);

  return (
    <AppShell wide back="/teacher" tone={room.phase === "collecting" && !ended ? "board" : "paper"}
      eyebrow={<>{room.title !== room.theme && <span>{room.title}</span>}{room.className && <span>{room.className}</span>}<span className={`pill pill--${state === "議論中" ? "live" : state === "終了" ? "done" : "ready"}`}>{state}</span></>}
      title={room.theme || room.title}
      actions={<>{source === "mock" && <span className="tag tag--yellow">デモデータ</span>}
        {/* 教室に映す画面（main #54）。操作画面とは分け、参加コード・時間・全員に表示した問いかけだけを出す */}
        {!ended && <a className="btn btn--small present-link" href={`/rooms/${roomId}/present`} target="_blank" rel="noopener">投影画面</a>}
        <button type="button" className="icon-btn" aria-label="設定" title="設定" onClick={() => settings.current?.showModal()}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
        </button></>}>

      {room.phase !== "collecting" && <ProcessingStatus roomId={roomId} />}
      {room.phase === "collecting" && <Lobby roomId={roomId} room={room} seats={seats} onStarted={() => setConfirmedStart(roomId)} />}
      {room.phase === "collecting" && !ended && <MaterialManager roomId={roomId} />}
      {room.classroomCourseId && room.phase === "collecting" && <ClassroomRoster key={roomId} roomId={roomId} />}
      {!ended && room.phase !== "collecting" && <LiveBoard roomId={roomId} room={room} members={members} insights={insights} />}
      {ended && (openGroup
        ? <div className="teacher__body"><button className="text-btn" onClick={() => setOpenGroup(undefined)}>セッション全体に戻る</button><GroupResultView result={results.find((r) => r.group === openGroup) ?? null} group={openGroup} roomId={roomId} source={source} /></div>
        : <div className="teacher__body">
          <GroupDashboard title={room.theme || room.title} status="終了" details={group => <GroupEvidence roomId={roomId} group={group.id} />} groups={sessionGroups(room, members,
            (feed.collections[`sessions/${roomId}/speaking`] ?? []) as unknown as SpeakingState[],
            (feed.collections[`sessions/${roomId}/results`] ?? []) as ({ id: string } & Partial<Flow>)[])} />
          <ConsensusProgress roomId={roomId} room={room} results={results} summary={summary ?? null} />
          <ClassResult roomId={roomId} room={room} results={results} summary={summary ?? null} onOpen={setOpenGroup} />
          <HostSpeaking roomId={roomId} card ended />
          <SessionEvidence roomId={roomId} />
          <RecordingReview roomId={roomId} room={room} />
        </div>)}

      <dialog ref={settings} className="dialog" aria-labelledby="settings-title" onClick={(e) => { if (e.target === settings.current) settings.current?.close(); }}>
        <div className="dialog__head"><h2 id="settings-title" className="t-md">設定</h2><button type="button" className="btn btn--small" onClick={() => settings.current?.close()}>閉じる</button></div>
        <SessionSettings roomId={roomId} room={room} embedded />
        {room.phase !== "collecting" && <MaterialManager roomId={roomId} ended={ended}
          onPickStart={() => settings.current?.close()}
          onPickEnd={() => { if (settings.current?.isConnected && !settings.current.open) settings.current.showModal(); }} />}
      </dialog>
    </AppShell>
  );
}

/** 準備中：教室に映す参加コードとQR、集まり具合、開始 */
function Lobby({ roomId, room, seats, onStarted }: { roomId: string; room: Room; seats: number; onStarted: () => void }) {
  const [qr, setQr] = useState<string>();
  const code = room.joinCode ?? "";
  useEffect(() => {
    if (!code) return;
    QRCode.toDataURL(`${window.location.origin}/join?code=${code}`, { margin: 1, width: 520 }).then(setQr).catch(() => setQr(undefined));
  }, [code]);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [notReady, setNotReady] = useState("");
  async function start(excludeNotReady = false) {
    setBusy(true); setMessage(""); setNotReady("");
    try {
      await callApi(`/rooms/${roomId}/phase`, { to: "discussing", ...(excludeNotReady ? { excludeNotReady } : {}) });
      onStarted(); refreshRoomFeed(roomId);
    }
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
        </dl>
        {notReady && <div className="notice notice--warn stack" role="alert"><p>{notReady}。外した参加者は、このセッションに参加できなくなります。</p>
          <button className="btn btn--blue" disabled={busy} onClick={() => void start(true)}>未準備の参加者を外して開始</button></div>}
        {message && <p className="notice notice--error" role="alert">{message}</p>}
        <button className="btn btn--blue btn--block start-btn" disabled={busy} onClick={() => void start()}>{busy ? "開始しています…" : "議論を開始"}</button>
        <p className="t-note">開始すると、新しい参加は受け付けません。全員がそろってから始めてください。</p>
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
      <div className="heading-row"><h2 id="review-title" className="t-sm">録音の振り返り</h2>{summary?.source === "mock" && <span className="pill">デモデータ</span>}</div>
      <p className="t-note">分析済み {summary?.analyzedGroups ?? 0}/{room.groups ?? 1}グループ</p>
      {groups.map((g) => <ReviewGroup key={g} roomId={roomId} group={g} />)}
      <Link className="btn btn--blue" href="/teacher" style={{ alignSelf: "flex-start" }}>ホームに戻る</Link>
    </section>
  );
}
function ReviewGroup({ roomId, group }: { roomId: string; group: number }) {
  const flow = useDoc<Flow>(`sessions/${roomId}/results/flow-g${group}`).data;
  return (
    <div className="review-group">
      <h3 className="t-label">グループ{group}</h3>
      {flow ? <>
        <p>{flow.flowNote}</p>
        {!!flow.good.length && <ul className="review-list">{flow.good.map((p, i) => <li key={i}><span className="pill pill--live">よかった点</span>{p.text}</li>)}</ul>}
        {!!flow.review.length && <ul className="review-list">{flow.review.map((p, i) => <li key={i}><span className="pill">次に試すこと</span>{p.text}</li>)}</ul>}
      </> : <p className="t-note">録音の送信・分析を待っています。録音しなかったグループには振り返りがありません。</p>}
    </div>
  );
}
