"use client";
import { AppShell } from "@/components/shell";
import Link from "next/link";
import { Presentation, Settings } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { useGeminiSource } from "@/components/ui";
import { ApiError, callApi } from "@/lib/api";
import { millis, useDoc, useGroupResults, useInsights, useMembers, type Flow, type GroupPoints, type GroupResult, type Room, type Summary } from "@/lib/room";
import { ClassResult, GroupResultView } from "./HostRoom";
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
          {/* いまやることを1つだけ大きく：結論の提出待ち → 結果をまとめる。データのない欄は出さない */}
          <EndedFocus roomId={roomId} room={room} results={results} summary={summary ?? null} />
          {results.length > 0 && <ClassResult roomId={roomId} room={room} results={results} summary={summary ?? null} onOpen={setOpenGroup} />}
          <HostSpeaking roomId={roomId} card ended />
          <RecordingReview roomId={roomId} room={room} />
          <p><Link className="text-btn" href="/teacher">教員のホームに戻る</Link></p>
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

/**
 * 終了後の主役。学生が結論を書いているあいだは提出の進み具合、全グループがそろったら「結果をまとめる」、
 * まとめたあとは目立たない帯（まとめ直す）にする。
 */
function EndedFocus({ roomId, room, results, summary }: { roomId: string; room: Room; results: GroupResult[]; summary: Summary | null }) {
  const [busy, setBusy] = useState<string>(), [message, setMessage] = useState("");
  const groups = Array.from({ length: room.groups ?? 1 }, (_, i) => i + 1);
  const states = groups.map((g) => ({ g, done: results.some((r) => r.group === g), submitted: room.groupState?.[String(g)]?.submitted ?? 0, total: room.groupState?.[String(g)]?.total ?? 0 }));
  const submitted = states.reduce((n, s) => n + s.submitted, 0), total = states.reduce((n, s) => n + s.total, 0);
  const allDone = states.every((s) => s.done || s.total === 0) && results.length > 0;
  const running = room.consensusAnalysis?.status === "running";
  async function run(path: string, body: object, key: string) {
    setBusy(key); setMessage("");
    try { await callApi(`/rooms/${roomId}/${path}`, body); }
    catch (e) { setMessage((e as Error).message); }
    finally { setBusy(undefined); }
  }
  const summarize = (primary: boolean, label: string) => (
    <button className={`btn${primary ? " btn--blue" : ""}`} disabled={!!busy || running || results.length === 0} onClick={() => void run("consensus/analyze", {}, "all")}>
      {busy === "all" || running ? "まとめています…" : label}
    </button>
  );
  const groupList = (
    <ul className="ended-hero__groups" aria-label="グループごとの提出">
      {states.map((s) => <li key={s.g} data-done={s.done || undefined}><span>グループ{s.g}：{s.done ? "結果あり" : `提出 ${s.submitted}/${s.total}人`}</span>
        {!s.done && s.submitted > 0 && <button className="btn btn--small" disabled={!!busy} onClick={() => void run("groups/analyze", { group: s.g }, `g${s.g}`)}>{busy === `g${s.g}` ? "分析しています…" : "今の回答で結果を出す"}</button>}
      </li>)}
    </ul>
  );
  const error = message && <p className="notice notice--warn" role="alert">{message}</p>;
  if (summary) return (
    <section className="ended-hero ended-hero--quiet" aria-labelledby="ended-title">
      <h2 id="ended-title" className="ended-hero__title">結果をまとめました</h2>
      {summarize(false, "結果をまとめ直す")}
      {error}
    </section>
  );
  if (total === 0) return (
    <section className="ended-hero" aria-labelledby="ended-title">
      <h2 id="ended-title" className="ended-hero__title">この議論には参加者がいませんでした</h2>
      <p className="ended-hero__lead">結論の一文がないので、結果はありません。</p>
    </section>
  );
  if (allDone) return (
    <section className="ended-hero" aria-labelledby="ended-title">
      <h2 id="ended-title" className="ended-hero__title">全員の結論がそろいました</h2>
      <p className="ended-hero__lead">結果をまとめると、同じ結論でも理解がどう分かれたかと、議論の指標が出ます。</p>
      {groupList}
      <div className="ended-hero__actions">{summarize(true, "結果をまとめる")}</div>
      {error}
    </section>
  );
  return (
    <section className="ended-hero" aria-labelledby="ended-title">
      <h2 id="ended-title" className="ended-hero__title">学生が結論を書いています</h2>
      <p className="ended-hero__count" aria-label={`提出 ${submitted}/${total}人`}>{submitted}<small>/{total}人が提出</small></p>
      <div className="ended-hero__bar" aria-hidden="true"><span style={{ width: `${total ? Math.round(submitted / total * 100) : 0}%` }} /></div>
      <p className="ended-hero__lead">グループの全員が書くと、そのグループの結果が自動で出ます。来ていない人がいるときは、今の回答で結果を出せます。</p>
      {groupList}
      {results.length > 0 && <div className="ended-hero__actions">{summarize(false, "結果をまとめる")}<span className="t-note">結果の出たグループだけでまとめます。</span></div>}
      {error}
    </section>
  );
}

interface SessionSummary { analyzedGroups: number; good: { group: number; text: string }[]; review: { group: number; text: string }[]; source: string }

/** 終了後：録音の分析から、議論の進め方の振り返り（録音しなかったグループは出ない） */
function RecordingReview({ roomId, room }: { roomId: string; room: Room }) {
  const summary = useDoc<SessionSummary>(`sessions/${roomId}/results/session-summary`).data;
  const groups = Array.from({ length: room.groups ?? 1 }, (_, i) => i + 1);
  // 録音を送ったグループがなければ、空の欄は出さない
  if (room.recording === false || !groups.some((g) => room.groupState?.[String(g)]?.recording?.status)) return null;
  return (
    <section className="flow-card stack" aria-labelledby="review-title">
      <div className="heading-row"><h2 id="review-title" className="t-sm">録音の振り返り</h2></div>
      <p className="t-note">分析済み {summary?.analyzedGroups ?? 0}/{room.groups ?? 1}グループ</p>
      {groups.map((g) => <ReviewGroup key={g} roomId={roomId} group={g} />)}
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
