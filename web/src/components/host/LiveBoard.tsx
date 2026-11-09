"use client";
import { useEffect, useRef, useState } from "react";
import { SessionGroups } from "./SessionGroups";
import { SessionMaterials } from "@/components/SessionMaterials";
import { SessionJoinCode } from "@/components/SessionJoinCode";
import type { SpeakingState } from "@/components/Speaking";
import { ProgressRing } from "./SessionCharts";
import { GeminiLabel } from "@/components/GeminiLabel";
import { groupSpeakingBalance } from "@/lib/group-balance";
import { ApiError, callApi } from "@/lib/api";
import { millis, useDoc, useMessages, type Coverage, type Insight, type Member, type Room } from "@/lib/room";
import { useRoomFeed } from "@/lib/room-stream";

/** API は分析中の記録を60秒で期限切れにする。画面も同じ期限でボタンを戻す */
const ANALYSIS_LOCK_MS = 60_000;
/** 新しいメモが届いたら、前の分析から60秒あけて自動で探す（Gemini の呼び出しは1部屋で1分に1回まで） */
const AUTO_GAP_MS = 60_000;

/**
 * 議論中の教員の画面（教室に投影する黒板）。司会者が「次に何をすべきか」を一目で決められるように、
 * 経過時間と終了操作、円グラフとグループカードで全体を把握し、
 * 主役に AI が見つけた「まだ話されていない論点」の付箋（全員に表示する／見送る）を置く（Docs「アプリの構想」§3）。
 * 事前意見の本文は出さない（提案は Gemini が言い換えた論点だけ）。
 */
export function LiveBoard({ roomId, room, members, insights }: { roomId: string; room: Room; members: Member[]; insights: Insight[] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const coverage = useDoc<Coverage>(`sessions/${roomId}/results/coverage`).data;
  const messages = useMessages(roomId, true);
  const speaking = (useRoomFeed(roomId).collections[`sessions/${roomId}/speaking`] ?? []) as unknown as SpeakingState[];
  const pending = insights.filter((i) => i.status === "pending");
  const approved = insights.filter((i) => i.status === "approved");

  const started = millis(room.startedAt);
  const elapsed = started ? Math.max(0, Math.floor((now - started) / 1000)) : 0;
  const scan = useScan(roomId, room, messages.map((m) => millis(m.createdAt) ?? 0), now);
  const balance = groupSpeakingBalance(speaking, room.groups ?? 1);
  const missing = pending.filter(i => i.kind !== "new_angle");
  const ideas = pending.filter(i => i.kind === "new_angle");

  const [busyId, setBusyId] = useState<string>(), [error, setError] = useState("");
  async function decide(id: string, action: "approve" | "dismiss") {
    setBusyId(id); setError("");
    try { await callApi(`/rooms/${roomId}/insights/${id}/${action}`); }
    catch (e) { setError((e as Error).message); }
    finally { setBusyId(undefined); }
  }

  const scanLabel = scan.running ? "分析中…" : scan.wait > 0 ? `あと${scan.wait}秒` : "分析を更新";
  const scanNote = scan.paused ? "分析を一時停止しています。" : scan.message;
  const actions = (i: Insight, primary = true) => (
    <div className="proposal__actions">
      <button className={`btn${primary ? " btn--ink" : ""}`} disabled={busyId === i.id} onClick={() => void decide(i.id, "approve")}>全員に表示する</button>
      <button className="btn" disabled={busyId === i.id} onClick={() => void decide(i.id, "dismiss")}>見送る</button>
    </div>
  );

  return (
    <div className="teacher__body live">
      <section className="dashboard-session" aria-label="議論の進み具合">
        <div className="dashboard-session__heading"><div><p className="dashboard-live-label"><span aria-hidden="true" />LIVE</p><h2 className="t-md">セッション中</h2></div>
          <div className="dashboard-session__clock"><span className="t-note">経過時間</span><p role="timer" aria-label="経過時間">{String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")}</p></div>
        </div>
        <FinishButton roomId={roomId} />
      </section>
      <section className="dashboard-metrics" aria-label="ダッシュボード">
        <article className="dashboard-metric"><ProgressRing label="意見の検討率" value={coverage?.reflectionRate ?? null} note={coverage ? `話された論点 ${coverage.discussed}/${coverage.total}` : "分析後に表示"} /></article>
        <article className="dashboard-metric"><ProgressRing label="発言バランス（平均）" value={balance.value} note={`${balance.groups}/${room.groups ?? 1}グループ · 発言時間から推定`} /></article>
        <article className="dashboard-metric dashboard-metric--pending"><div><p className="t-note">未検討の論点</p><strong>{missing.length}<small>件</small></strong></div><p className="t-note">{missing.length ? "不足している観点を確認" : "分析結果を右側に表示"}</p></article>
      </section>
      <SessionGroups roomId={roomId} room={room} members={members} dashboard />

      <div className="live-grid">
        <section className="next gemini-analysis" aria-label="Geminiの分析結果">
          <div className="gemini-analysis__header"><h2 className="t-sm"><GeminiLabel source={coverage?.source} /></h2><button className="btn btn--small" onClick={() => void scan.run()} disabled={scan.running || scan.wait > 0}>{scanLabel}</button></div>
          {error && <p className="notice notice--error" role="alert">{error}</p>}
          {scanNote && <p className="t-note" role="status">{scanNote}</p>}
          <section className="gemini-analysis__section" aria-label="不足している観点">
            <h3 className="t-label">不足している観点</h3>
            {missing.length ? missing.map(i => <article className="box--yellow proposal" key={i.id}><p className="sr-only">まだ議論されていない論点</p><p className="t-md proposal__text">{i.summary}</p>{actions(i)}</article>) : <p className="t-note">{coverage ? "現在はありません。" : "共有メモが届くと分析できます。"}</p>}
          </section>
          <section className="gemini-analysis__section" aria-label="新しい切り口">
            <h3 className="t-label">新しい切り口</h3>
            {ideas.length ? ideas.map(i => <article className="proposal proposal--idea" key={i.id}><p className="t-md proposal__text">{i.summary}</p>{actions(i, false)}</article>) : <p className="t-note">{coverage ? "現在はありません。" : "分析結果を待っています。"}</p>}
          </section>
        </section>

        <aside className="live-side" aria-label="グループと発言">
          <section className="shown" aria-labelledby="shown-title">
            <h2 id="shown-title" className="live-side__title">学生に表示中の問いかけ</h2>
            {approved.length
              ? <ul className="shown__list">{approved.map((i) => <li key={i.id} className="note note--paper">{i.summary}</li>)}</ul>
              : <p className="t-note">まだありません。論点を「全員に表示する」と、ここと学生の画面に出ます。</p>}
          </section>
          {/* AI が読み取った論点のうち、どれが話されて、どれがまだかを一覧で見る（言い換えた論点だけ。事前意見の本文は出さない） */}
          {!!coverage?.points?.length && <details className="analysis-evidence"><summary>分析の根拠（{coverage.discussed}/{coverage.total}）</summary><h2 className="sr-only">AI が読み取った論点（話された {coverage.discussed}/{coverage.total}）</h2><ul className="points__list">{coverage.points.map((point, i) => <li key={i} data-discussed={point.discussed || undefined}><span className="points__mark" aria-hidden="true" />{point.summary}<span className="sr-only">{point.discussed ? "（話された）" : "（まだ）"}</span></li>)}</ul></details>}
          {room.joinCode && <SessionJoinCode code={room.joinCode} />}
        </aside>
      </div>
      <SessionMaterials roomId={roomId} editable />
    </div>
  );
}

/**
 * 未検討の論点を探す。手動のボタンに加えて、新しいメモが届いていて、前の分析（なければ開始）から
 * 60秒たったら自動で探す。API の30秒の間隔と重複の排他はそのまま守る。
 */
function useScan(roomId: string, room: Room, messageTimes: number[], now: number) {
  const [busy, setBusy] = useState(false), [wait, setWait] = useState(0), [paused, setPaused] = useState(false), [message, setMessage] = useState("");
  const startedAt = room.analysis?.status === "running" ? millis(room.analysis.startedAt) : undefined;
  const locked = room.analysis?.status === "running" && (startedAt === undefined || now - startedAt < ANALYSIS_LOCK_MS);
  const running = busy || locked;
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function run(auto = false) {
    setBusy(true); setPaused(false); if (!auto) setMessage("");
    try {
      const r = await callApi<{ suggested: number }>(`/rooms/${roomId}/analyze`);
      setMessage(r.suggested ? `新しい論点が ${r.suggested}件 見つかりました。` : "新しい論点は見つかりませんでした。");
      setWait(30);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 429) setWait(err.retryAfterSec ?? 30);
      else if (err.status === 503) setPaused(true);
      else if (!auto && err.status !== 409) setMessage(err.message);
    } finally { setBusy(false); }
  }

  const last = millis(room.analysis?.startedAt);
  const newest = messageTimes.length ? Math.max(...messageTimes) : 0;
  const due = !running && !paused && wait <= 0 && room.phase === "discussing"
    && newest > (last ?? 0) && now - (last ?? millis(room.startedAt) ?? now) >= AUTO_GAP_MS;
  useEffect(() => { if (due) void run(true); }, [due]); // eslint-disable-line react-hooks/exhaustive-deps

  return { run, running, wait, paused, message };
}

function FinishButton({ roomId }: { roomId: string }) {
  const confirm = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function finish() {
    setBusy(true); setError("");
    try { await callApi(`/rooms/${roomId}/finish`); confirm.current?.close(); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <div className="dashboard-finish">
    <button className="btn session-finish-button" onClick={() => { setError(""); confirm.current?.showModal(); cancel.current?.focus(); }}>議論を終える</button>
    <dialog ref={confirm} className="dialog session-finish-dialog" aria-labelledby="finish-dialog-title" aria-describedby="finish-dialog-description" onCancel={e => { if (busy) e.preventDefault(); }}>
      <div className="session-finish-dialog__body"><p className="session-finish-dialog__label">セッションの終了</p><h2 id="finish-dialog-title" className="t-md">セッションを終了しますか？</h2><p id="finish-dialog-description" className="t-note">全グループの議論を終了し、参加者は結論の入力へ進みます。</p>
        {error && <p className="notice notice--error" role="alert">{error}</p>}
        <div className="session-finish-dialog__actions"><button ref={cancel} className="btn" disabled={busy} onClick={() => confirm.current?.close()}>続行する</button><button className="btn session-finish-button" disabled={busy} onClick={() => void finish()}>{busy ? "終えています…" : "終了する"}</button></div>
      </div>
    </dialog>
  </div>;
}
