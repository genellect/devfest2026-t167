"use client";
import { useEffect, useState } from "react";
import { type SpeakingState } from "@/components/Speaking";
import { SourceTag } from "@/components/ui";
import { ApiError, callApi } from "@/lib/api";
import { millis, useDoc, useGroups, useMessages, type Coverage, type GroupResult, type Insight, type Member, type Room } from "@/lib/room";
import { formatClock, useDiscussionClock } from "@/components/DiscussionClock";
import { GroupCards } from "./GroupCards";
import { useRoomFeed } from "@/lib/room-stream";

/** API は分析中の記録を60秒で期限切れにする。画面も同じ期限でボタンを戻す */
const ANALYSIS_LOCK_MS = 60_000;
/** 新しいメモが届いたら、前の分析から60秒あけて自動で探す（Gemini の呼び出しは1部屋で1分に1回まで） */
const AUTO_GAP_MS = 60_000;

/**
 * 議論中の教員の画面（Figma「最新」ダッシュボード（進行）182:445）。司会者が「次に何をすべきか」を一目で決められるように、
 * 上の青い帯に時間・授業の進み具合・未検討の論点・終える、その下にグループのカードを置く。
 * AI が見つけた「まだ話されていない論点」（中核の機能。Docs「アプリの構想」§3）が届いたら、グループのカードより上に出す。
 * 事前意見の本文は出さない（提案は Gemini が言い換えた論点だけ）。
 * 1本化した流れでは、議論は教員が一斉に終えるので、議論中のグループは「事前の意見」か「話し合い中」のどちらか。
 */
export function LiveBoard({ roomId, room, members, insights, results = [] }: { roomId: string; room: Room; members: Member[]; insights: Insight[]; results?: GroupResult[] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const coverage = useDoc<Coverage>(`sessions/${roomId}/results/coverage`).data;
  const messages = useMessages(roomId, true);
  const speaking = (useRoomFeed(roomId).collections[`sessions/${roomId}/speaking`] ?? []) as unknown as SpeakingState[];
  const groupConfigs = useGroups(roomId);
  const pending = insights.filter((i) => i.status === "pending");
  const groupNumbers = Array.from({ length: room.groups ?? 1 }, (_, i) => i + 1);
  const approved = insights.filter((i) => i.status === "approved");

  const clock = useDiscussionClock(room);
  const scan = useScan(roomId, room, messages.map((m) => millis(m.createdAt) ?? 0), now);

  const [busyId, setBusyId] = useState<string>(), [error, setError] = useState("");
  async function decide(id: string, action: "approve" | "dismiss") {
    setBusyId(id); setError("");
    try { await callApi(`/rooms/${roomId}/insights/${id}/${action}`); }
    catch (e) { setError((e as Error).message); }
    finally { setBusyId(undefined); }
  }

  // 未検討の論点が届いたら、論点を先に、グループのカードを後に並べる
  const cards = <GroupCards roomId={roomId} room={room} groups={groupNumbers} results={results} speaking={speaking} configs={groupConfigs} now={now} />;
  // 段階ごとに「今やること」を1つだけ大きく見せる。提案があれば、次に投げかける1つを主役に、残りは下に小さく並べる
  const [focus, ...rest] = pending;
  const headline = focus ? "この論点を投げかけましょう"
    : scan.running ? "AI が議論を読み取っています"
      : coverage && coverage.total > 0 && coverage.discussed === coverage.total ? "事前の意見の論点は、すべて話されています"
        : coverage ? "いまは新しい提案はありません"
          : "議論を見守りましょう";
  const lead = focus ? "事前の意見にあったのに、まだ話されていない論点です。投げかけると、学生のスマホと投影画面に問いかけとして出ます。"
    : coverage ? "新しいメモが届くと、また探します。話が尽きたら、議論を終えて結論を書いてもらいましょう。"
      : "学生がメモを共有すると、AI が事前の意見と照らし合わせて、まだ話されていない論点を探します。";
  const scanLabel = scan.running ? "分析中…" : scan.wait > 0 ? `あと ${scan.wait} 秒で探せます` : "未検討の論点を探す";
  const scanNote = scan.paused ? "AI の分析は一時停止中です。議論はそのまま続けられます。" : scan.message || "新しいメモが届くと、60秒ごとに自動でも探します。提案は教員の画面だけに出ます。";
  // 主役の付箋だけ濃いボタンにする（ほかの候補は控えめにして、視線を1つに集める）
  const actions = (i: Insight, primary = true) => (
    <div className="proposal__actions">
      <button className={`btn${primary ? " btn--ink" : ""}`} disabled={busyId === i.id} onClick={() => void decide(i.id, "approve")}>全員に表示する</button>
      <button className="btn" disabled={busyId === i.id} onClick={() => void decide(i.id, "dismiss")}>見送る</button>
    </div>
  );

  return (
    <div className="teacher__body live">
      {/* Figma「最新」ダッシュボード（進行）182:445：上の青い帯に、経過時間・授業の進み具合・未検討の論点・終える */}
      <section className="tally tally--blue" aria-label="議論の進み具合">
        <div className="tally__clock"><p className="tally__label">{clock?.label ?? "経過時間"}</p><p className="tally__time" role="timer" aria-label={clock?.label ?? "経過時間"}>{formatClock(clock?.seconds ?? 0)}</p></div>
        <div className="tally__progress">
          <p className="tally__label">授業の進み具合・参加 {members.length}人</p>
          <p className="tally__headline">結果が出たグループ {groupNumbers.filter((g) => room.groupState?.[String(g)]?.status === "done").length}/{groupNumbers.length}</p>
        </div>
        {/* 数字を押すと、論点の欄へ移る（グループが多いときも、中核の機能にすぐ届くように） */}
        <a className="tally__alert" href="#next-title" data-alert={pending.length > 0 || undefined} aria-label={`未検討の論点 ${pending.length}件。論点の欄へ移る`}>
          <p className="tally__label">未検討の論点</p>
          <p className="tally__num">{pending.length}{coverage && <small>話された {coverage.discussed}/{coverage.total}</small>}</p>
        </a>
        <FinishButton roomId={roomId} />
      </section>

      {pending.length === 0 && cards}

      <div className="live-grid">
        <section className="next" aria-labelledby="next-title">
          <h2 id="next-title" className="next__title">{headline}</h2>
          <p className="next__lead">{lead}</p>
          {error && <p className="notice notice--error" role="alert">{error}</p>}
          {focus ? (
            <article className="box--yellow proposal proposal--focus" aria-label="次に投げかける論点">
              <div className="proposal__head"><p className="t-label">まだ議論されていない論点</p><SourceTag source={focus.source} /></div>
              <p className="t-md proposal__text">{focus.summary}</p>
              {actions(focus)}
            </article>
          ) : (
            <div className="next__idle">
              <button className="btn btn--blue" onClick={() => void scan.run()} disabled={scan.running || scan.wait > 0}>{scanLabel}</button>
              <p className="t-note" role="status">{scanNote}</p>
            </div>
          )}
          {rest.length > 0 && (
            <section className="queue" aria-labelledby="queue-title">
              <h3 id="queue-title" className="queue__title">ほかの候補 {rest.length}件</h3>
              <ul className="queue__list">
                {rest.map((i) => (
                  <li key={i.id} className="box--yellow proposal proposal--queued">
                    <p className="t-label sr-only">まだ議論されていない論点</p>
                    <p className="t-md proposal__text">{i.summary}</p>
                    {actions(i, false)}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {focus && (
            <div className="next__scan">
              <button className="btn btn--small" onClick={() => void scan.run()} disabled={scan.running || scan.wait > 0}>{scanLabel}</button>
              <p className="t-note" role="status">{scanNote}</p>
            </div>
          )}
        </section>

        <aside className="live-side" aria-label="グループと発言">
          <section className="shown" aria-labelledby="shown-title">
            <h2 id="shown-title" className="live-side__title">学生に表示中の問いかけ</h2>
            {approved.length
              ? <ul className="shown__list">{approved.map((i) => <li key={i.id} className="note note--paper">{i.summary}</li>)}</ul>
              : <p className="t-note">まだありません。論点を「全員に表示する」と、ここと学生の画面に出ます。</p>}
          </section>
          {/* AI が読み取った論点のうち、どれが話されて、どれがまだかを一覧で見る（言い換えた論点だけ。事前意見の本文は出さない） */}
          {!!coverage?.points?.length && (
            <section className="points" aria-labelledby="points-title">
              <h2 id="points-title" className="live-side__title">AI が読み取った論点（話された {coverage.discussed}/{coverage.total}）</h2>
              <ul className="points__list">
                {[...coverage.points].sort((a, b) => Number(a.discussed) - Number(b.discussed)).map((p, i) => (
                  <li key={i} data-discussed={p.discussed || undefined}><span className="points__mark" aria-hidden="true" />{p.summary}<span className="sr-only">{p.discussed ? "（話された）" : "（まだ）"}</span></li>
                ))}
              </ul>
            </section>
          )}
          {room.joinCode && <p className="live-side__code">途中から参加するときの参加コード<strong aria-label={room.joinCode.split("").join(" ")}>{room.joinCode.slice(0, 3)} {room.joinCode.slice(3)}</strong></p>}
        </aside>
      </div>
      {pending.length > 0 && cards}
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
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function finish() {
    setBusy(true); setError("");
    try { await callApi(`/rooms/${roomId}/finish`); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return (
    <div className="tally__end">
      {!confirm ? <button className="btn" onClick={() => setConfirm(true)}>議論を終える</button>
        : <><button className="btn btn--blue" disabled={busy} onClick={() => void finish()}>{busy ? "終えています…" : "終えて結果を見る"}</button><button className="btn" disabled={busy} onClick={() => setConfirm(false)}>まだ続ける</button></>}
      {error && <p className="notice notice--error" role="alert">{error}</p>}
    </div>
  );
}
