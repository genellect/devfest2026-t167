"use client";
import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { HostSpeaking } from "@/components/Speaking";
import { useGeminiSource } from "@/components/ui";
import { ApiError, callApi } from "@/lib/api";
import { millis, useDoc, useGroupResults, useInsights, useMembers, type Flow, type Room, type Summary } from "@/lib/room";
import { AiPanel, ClassResult, ConsensusProgress, GroupResultView } from "./HostRoom";
import { SessionSettings } from "./SessionSettings";

/**
 * 教員の画面（1本化した流れ）。段階ごとに主役を1つにする（Docs「UIフィードバック」）。
 * 準備中：参加コードとQR・参加人数・事前意見の提出数・開始／議論中：未検討の論点・グループの状況・終了／
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
    <main className="screen teacher">
      <header className="appbar">
        <div className="appbar__title">
          <p className="appbar__who">{room.className ? `${room.className}　` : ""}<span className={`pill pill--${state === "議論中" ? "live" : state === "終了" ? "done" : "ready"}`}>{state}</span>{source === "mock" && <span className="pill">デモデータ</span>}</p>
          <h1 className="appbar__theme">{room.theme || room.title}</h1>
        </div>
        <button type="button" className="icon-btn" aria-label="設定" title="設定" onClick={() => settings.current?.showModal()}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
        </button>
        <Link className="btn btn--small" href="/home">ホーム</Link>
      </header>

      {room.phase === "collecting" && <Lobby roomId={roomId} room={room} seats={seats} opinions={opinions} />}
      {!ended && room.phase !== "collecting" && <Live roomId={roomId} room={room} seats={seats} insights={insights} />}
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
    </main>
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
        <button className="btn btn--blue btn--block start-btn" disabled={busy} onClick={() => void start()}>{busy ? "開始しています…" : "ディスカッションを開始"}</button>
        <p className="t-note">開始すると、新しい参加は受け付けません。全員がそろってから始めてください。</p>
      </section>
    </div>
  );
}

/** 議論中：経過時間と終了、未検討の論点、グループの状況と発言時間 */
function Live({ roomId, room, seats, insights }: { roomId: string; room: Room; seats: number; insights: Parameters<typeof AiPanel>[0]["insights"] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const started = millis(room.startedAt);
  const elapsed = started ? Math.max(0, Math.floor((now - started) / 1000)) : 0;
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function finish() {
    setBusy(true); setError("");
    try { await callApi(`/rooms/${roomId}/finish`); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  const groups = Array.from({ length: room.groups ?? 1 }, (_, i) => i + 1);
  return (
    <div className="teacher__body">
      <section className="live-bar" aria-label="議論の進み具合">
        <p className="live-bar__time" role="timer" aria-label="経過時間">{String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")}</p>
        <p className="t-label">参加 {seats}人</p>
        <div className="live-bar__end">
          {!confirm ? <button className="btn btn--blue" onClick={() => setConfirm(true)}>ディスカッションを終える</button>
            : <><button className="btn btn--blue" disabled={busy} onClick={() => void finish()}>{busy ? "終えています…" : "終えて結果を見る"}</button><button className="btn" disabled={busy} onClick={() => setConfirm(false)}>まだ続ける</button></>}
        </div>
        {error && <p className="notice notice--error" role="alert">{error}</p>}
      </section>
      <div className="live-grid">
        <AiPanel roomId={roomId} room={room} insights={insights} />
        <div className="stack">
          <section className="flow-card" aria-labelledby="groups-title">
            <h2 id="groups-title" className="t-sm">グループ</h2>
            <ul className="group-list">
              {groups.map((g) => {
                const st = room.groupState?.[String(g)];
                return <li key={g}><span>グループ{g}</span><span className="t-note">{st?.total ?? 0}人{st?.recording?.status ? `・録音の分析：${{ analyzing: "分析中", done: "完了", failed: "失敗" }[st.recording.status]}` : ""}</span></li>;
              })}
            </ul>
          </section>
          <HostSpeaking roomId={roomId} card />
        </div>
      </div>
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
      <Link className="btn btn--blue" href="/home" style={{ alignSelf: "flex-start" }}>ホームに戻る</Link>
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
