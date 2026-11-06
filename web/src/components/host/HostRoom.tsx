"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { HostSpeaking } from "@/components/Speaking";
import { GuidedHostResults } from "./GuidedHostResults";
import { SessionSettings } from "./SessionSettings";
import { FlowTimeline, GoodReview, useFlow } from "@/components/flow";
import { Header, SourceTag, Tag, useGeminiSource } from "@/components/ui";
import { ApiError, callApi } from "@/lib/api";
import { formatMetric } from "@/lib/format";
import Link from "next/link";
import { getDuration, getRoomLabel } from "@/lib/local";
import {
  groupStatus, millis, useGroups, useCountdown, useDoc, useGroupResults, useInsights, useMembers,
  type Coverage, type GroupResult, type Insight, type Room, type Summary,
} from "@/lib/room";

interface Props { roomId: string; room: Room }

/**
 * Host（PC）の画面。グループはそれぞれのペースで進むので、Hostは一斉に開かない。
 * 参加コードの表示 ⇄ ダッシュボード（グループの進み具合と結果）→ セッションを終える → セッション全体の結果
 */
export function HostRoom({ roomId, room }: Props) {
  const source = useGeminiSource();
  const clock = useCountdown(millis(room.startedAt), room.minutes ?? 15);
  useEffect(() => { if (room.flowVersion === 1 && clock.over && room.phase === "discussing" && !room.endedAt) void callApi(`/rooms/${roomId}/check-time`).catch(() => {}); }, [room.flowVersion, clock.over, room.phase, room.endedAt, roomId]);
  const summary = useDoc<Summary>(room.phase === "consensus" || room.phase === "closed" ? `sessions/${roomId}/results/summary` : undefined).data;
  const results = useGroupResults(roomId, true);
  const members = useMembers(roomId, true).filter((m) => m.role === "participant" && m.status !== "inactive");
  const [phaseError, setPhaseError] = useState("");
  const [moving, setMoving] = useState(false);
  const [view, setView] = useState<"code" | "dashboard" | "class" | number>("dashboard");

  /** セッションを終える。部屋のフェーズを closed まで1つずつ進める */
  async function finish() {
    setMoving(true); setPhaseError("");
    try {
      if (room.flowVersion === 1) { await callApi(`/rooms/${roomId}/finish`); setView("class"); return; }
      const order: Room["phase"][] = ["collecting", "discussing", "consensus", "closed"];
      for (const p of order.slice(order.indexOf(room.phase) + 1)) {
        if (p === "closed") await callApi(`/rooms/${roomId}/consensus/analyze`);
        await callApi(`/rooms/${roomId}/phase`, { to: p });
      }
      setView("class");
    } catch (e) { setPhaseError((e as Error).message); }
    finally { setMoving(false); }
  }

  const [label, setLabel] = useState("");
  useEffect(() => { setLabel(getRoomLabel(roomId)); }, [roomId]);
  const closed = room.phase === "closed" || !!room.endedAt;
  const current = closed && (view === "dashboard" || view === "code") ? "class" : view;
  const eyebrow = typeof current === "number"
    ? `セッション全体 ＞ グループ${current}`
    : `${label ? `${label}　` : ""}${current === "class" ? "セッション全体の結果" : `参加コード ${room.joinCode ?? ""}`}`;
  const back = typeof current === "number" ? (closed ? "class" : "dashboard") : current === "class" && !closed ? "dashboard" : current === "code" ? "dashboard" : undefined;
  return (
    <main className="screen">
      <Header eyebrow={eyebrow} title={typeof current === "number" ? `グループ${current}の話し合い` : room.title} demo={source === "mock"}>
        {back && <button className="btn btn--small" onClick={() => setView(back)}>{back === "class" ? "セッション全体に戻る" : "ダッシュボード"}</button>}
        {current === "dashboard" && <button className="btn btn--small" onClick={() => setView("code")}>参加コードを表示</button>}
        {current === "dashboard" && results.length > 0 && <button className="btn btn--small" onClick={() => setView("class")}>セッション全体の結果</button>}
        <Link className="btn btn--small" href="/host">ホーム</Link>
      </Header>
      <SessionSettings roomId={roomId} room={room} />
      {room.flowVersion === 1 && current !== "code" && <HostSpeaking roomId={roomId} />}
      {room.flowVersion === 1 && room.phase === "discussing" && !room.endedAt && <p className="notice" role="timer">残り時間 {clock.text}</p>}
      {phaseError && <p className="notice notice--error notice--inset" role="alert">{phaseError}</p>}
      {!closed && current === "code" && <Lobby room={room} joined={members.reduce((n, m) => n + (m.attendees?.length || 1), 0)} onNext={() => setView("dashboard")} />}
      {!closed && current === "dashboard" && (
        <Dashboard roomId={roomId} room={room} results={results} members={members} onOpen={setView} onFinish={finish} moving={moving} />
      )}
      {current === "class" && room.flowVersion === 1 && <GuidedHostResults roomId={roomId} room={room} />}
      {current === "class" && room.flowVersion !== 1 && <ClassResult roomId={roomId} room={room} results={results} summary={summary ?? null} onOpen={setView} />}
      {typeof current === "number" && (
        <GroupResultView result={results.find((r) => r.group === current) ?? null} group={current} roomId={roomId} source={source} />
      )}
    </main>
  );
}

/** S3 参加コード・QR の表示。参加者は参加したあと、自分でグループを選ぶ */
function Lobby({ room, joined, onNext }: { room: Room; joined: number; onNext: () => void }) {
  const [qr, setQr] = useState<string>();
  const code = room.joinCode ?? "";
  useEffect(() => {
    if (!code) return;
    QRCode.toDataURL(`${window.location.origin}/join?code=${code}`, { margin: 1, width: 520, color: { dark: "#000000", light: "#ffffff" } })
      .then(setQr).catch(() => setQr(undefined));
  }, [code]);

  return (
    <div className="body">
      <div className="split">
        <section className="box box--lg box--blue pad-lg stack" style={{ justifyContent: "center", gap: 12 }}>
          <p className="t-md" style={{ fontWeight: 700 }}>参加コード</p>
          <p data-testid="join-code" className="join-code">{code}</p>
          <p style={{ fontSize: 20 }}>コードを入力するか、QRコードを読み取ってください。</p>
          {(room.groups ?? 1) > 1 && <p className="t-label">参加したら、自分のグループ（1〜{room.groups}）を選びます。</p>}
        </section>
        <div className="stack" style={{ gap: 20 }}>
          <div className="box box--md" style={{ flex: 1, display: "grid", placeItems: "center", padding: 24, minHeight: 260 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {qr ? <img src={qr} alt={`参加用のQRコード（参加コード ${code}）`} style={{ width: "100%", maxWidth: 300, height: "auto", imageRendering: "pixelated" }} />
              : <p className="t-md">QRコード</p>}
          </div>
          <div className="box box--md pad stack stack--tight">
            <p className="t-label">参加した人</p>
            <p className="t-xl">{joined}人</p>
          </div>
          <button className="btn btn--yellow btn--block" onClick={onNext}>ダッシュボードを見る</button>
        </div>
      </div>
    </div>
  );
}

const STATUS_LABEL = { opinions: "事前の意見", discussing: "話し合い中", consensus: "結論を記入中", done: "結果あり" } as const;
const RECORDING_LABEL = { analyzing: "分析中", done: "完了", failed: "失敗（参加者の端末から送り直せます）" } as const;

/** S5 ダッシュボード。グループごとの進み具合（事前意見 → 話し合い → 結論の記入 → 結果）と AI の提案 */
function Dashboard({ roomId, room, results, members, onOpen, onFinish, moving }: {
  roomId: string; room: Room; results: GroupResult[]; members: { id: string; group?: number; ready?: boolean; attendees?: { voiceRegistered?: boolean }[] }[];
  onOpen: (g: number) => void; onFinish: () => void; moving: boolean;
}) {
  const configurations = useGroups(roomId);
  const insights = useInsights(roomId, true, false);
  const coverage = useDoc<Coverage>(`sessions/${roomId}/results/coverage`).data;
  const [confirm, setConfirm] = useState(false);
  const [busyGroup, setBusyGroup] = useState<number>();
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t); }, []);
  const groupCount = room.groups ?? 1;
  const seats = (list: typeof members) => list.reduce((n, m) => n + (m.attendees?.length || 1), 0);
  const minutes = room.minutes ?? getDuration(roomId);
  const unassigned = seats(members.filter((m) => !m.group && groupCount > 1));

  async function force(path: "start" | "analyze", g: number) {
    setBusyGroup(g); setError("");
    try { await callApi(`/rooms/${roomId}/groups/${path}`, { group: g }); }
    catch (e) { setError((e as Error).message); }
    finally { setBusyGroup(undefined); }
  }

  return (
    <div className="body" style={{ gap: 24 }}>
      <section className="box box--lg box--blue progress-hero">
        <div className="stack stack--tight progress-hero__main">
          <p className="t-label">授業の進み具合</p>
          <p className="t-xl">結果が出たグループ {results.length}/{groupCount}</p>
        </div>
        <div className="stack stack--tight progress-hero__meta">
          <p className="t-label">参加 {seats(members)}人{unassigned ? `・グループ未選択 ${unassigned}人` : ""}</p>
          {coverage && <p className="t-label">事前意見の論点の反映率 {formatMetric(coverage.reflectionRate, coverage.source === "mock" ? "mock" : "gemini")}</p>}
        </div>
        {!confirm
          ? <button className="btn btn--yellow" onClick={() => setConfirm(true)} disabled={moving}>セッションを終える</button>
          : (
            <div className="stack stack--tight">
              <button className="btn btn--yellow" onClick={onFinish} disabled={moving}>{moving ? "終えています…" : "終えて結果を見る"}</button>
              <button className="btn btn--small" onClick={() => setConfirm(false)} disabled={moving}>まだ続ける</button>
            </div>
          )}
      </section>
      {error && <p className="notice notice--warn" role="alert">{error}</p>}
      <div className="split">
        <div className="grid-auto">
          {Array.from({ length: groupCount }, (_, i) => i + 1).map((g) => {
            const st = room.groupState?.[String(g)];
            const result = results.find((r) => r.group === g);
            const status = result ? "done" : groupStatus(room, g);
            const peers = members.filter((m) => m.group === g);
            const n = room.flowVersion === 1 ? seats(peers) : st?.total ?? members.filter((m) => (m.group ?? (groupCount <= 1 ? 1 : 0)) === g).length;
            const started = millis(st?.startedAt);
            const detail = status === "opinions" ? (n ? room.flowVersion === 1 ? `音声登録済み ${peers.reduce((sum, m) => sum + (m.attendees?.filter((a) => a.voiceRegistered).length ?? 0), 0)}/${n}人` : `提出 ${st?.opinions ?? 0}/${n}人` : "まだだれもいません")
              : status === "discussing" ? `${n}人${started ? `・${Math.max(0, Math.floor((now - started) / 60000))}/${minutes}分` : ""}`
              : status === "consensus" ? `提出 ${st?.submitted ?? 0}/${n}人`
              : `${result?.respondents ?? n}人${result && result.clusters.length > 1 ? `・理解が${result.clusters.length}通り` : ""}`;
            return (
              <section key={g} className={`box box--md group-card${status === "done" ? " box--tint" : status === "consensus" || status === "opinions" && n ? " box--yellow" : ""}`}>
                <p className="t-label">{configurations.find((c) => c.number === g)?.name ?? `グループ${g}`}</p>
                <p className="t-lg">{status === "opinions" && !n ? "メンバー募集中" : room.flowVersion === 1 && status === "opinions" ? "参加準備中" : STATUS_LABEL[status]}</p>
                <p className="t-small">{detail}</p>
                {st?.recording?.status && <p className="t-small">録音の分析：{RECORDING_LABEL[st.recording.status]}</p>}
                {status === "done" && <button className="btn btn--small" style={{ alignSelf: "flex-start", marginTop: 6 }} onClick={() => onOpen(g)}>詳しく見る</button>}
                {status === "opinions" && n > 0 && (st?.opinions ?? 0) > 0 && (
                  <button className="btn btn--small" style={{ alignSelf: "flex-start", marginTop: 6 }} onClick={() => force("start", g)} disabled={busyGroup === g}>
                    {busyGroup === g ? "始めています…" : "今いるメンバーで始める"}
                  </button>
                )}
                {status === "consensus" && (st?.submitted ?? 0) > 0 && (
                  <button className="btn btn--small" style={{ alignSelf: "flex-start", marginTop: 6 }} onClick={() => force("analyze", g)} disabled={busyGroup === g}>
                    {busyGroup === g ? "分析中…" : "今の回答で結果を出す"}
                  </button>
                )}
              </section>
            );
          })}
        </div>
        {room.flowVersion !== 1 && <AiPanel roomId={roomId} room={room} insights={insights} />}
      </div>
    </div>
  );
}

/** API の分析中の記録の期限（api/src/app.ts の RUNNING_TIMEOUT_MS と同じ） */
const ANALYSIS_LOCK_MS = 60_000;

/** AI の分析ボタンと介入提案。提案はHostが承認したものだけが参加者に届く */
function AiPanel({ roomId, room, insights }: { roomId: string; room: Room; insights: Insight[] }) {
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState("");
  const [wait, setWait] = useState(0);
  const [msg, setMsg] = useState("");
  // API は分析中の記録を60秒で期限切れにする（途中で止まった分析が残っても、やり直せる）。画面も同じ期限でボタンを戻す
  const startedAt = room.analysis?.status === "running" ? millis(room.analysis.startedAt) : undefined;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (startedAt === undefined) return;
    const left = startedAt + ANALYSIS_LOCK_MS - Date.now();
    if (left <= 0) return;
    const t = setTimeout(() => setTick((n) => n + 1), left + 100);
    return () => clearTimeout(t);
  }, [startedAt]);
  const locked = room.analysis?.status === "running" && (startedAt === undefined || Date.now() - startedAt < ANALYSIS_LOCK_MS);
  const running = busy || locked;

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function analyze() {
    setBusy(true); setPaused(""); setMsg("");
    try {
      const r = await callApi<{ suggested: number }>(`/rooms/${roomId}/analyze`);
      setMsg(r.suggested ? `まだ議論されていない論点が ${r.suggested}件 見つかりました。` : "事前意見の論点は、すべて議論に出ています。");
      setWait(30);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 429) setWait(err.retryAfterSec ?? 30);
      else if (err.status === 503) setPaused(err.message);
      else setMsg(err.message);
    } finally { setBusy(false); }
  }
  async function approve(id: string) {
    try { await callApi(`/rooms/${roomId}/insights/${id}/approve`); } catch (e) { setMsg((e as Error).message); }
  }

  const pending = insights.filter((i) => i.status === "pending");
  const approved = insights.filter((i) => i.status === "approved");
  return (
    <section className="stack" style={{ gap: 20 }}>
      <div className="box box--md pad stack">
        <div className="heading-row"><h2 className="t-sm">AIからの介入提案</h2><Tag>Hostだけに表示</Tag></div>
        <p className="t-note">事前の意見と今の議論を照らし合わせ、まだ話されていない論点を探します。</p>
        <button className="btn btn--blue btn--block" onClick={analyze} disabled={running || wait > 0}>
          {running ? "分析中…" : wait > 0 ? `あと ${wait} 秒で再分析できます` : "未検討の論点を探す"}
        </button>
        {paused && <p className="notice notice--warn" role="status">AIの分析は一時停止中です。議論はそのまま続けられます。</p>}
        {msg && <p className="notice" role="status">{msg}</p>}
      </div>
      {pending.map((i) => (
        <div key={i.id} className="box box--md box--yellow pad stack">
          <div className="heading-row"><p className="t-label">まだ議論されていない論点</p><SourceTag source={i.source} /></div>
          <p className="t-md">{i.summary}</p>
          <div style={{ display: "flex", gap: 12 }}>
            <button className="btn btn--ink" onClick={() => approve(i.id)}>全員に表示する</button>
          </div>
        </div>
      ))}
      {approved.length > 0 && (
        <div className="box box--sm pad stack stack--tight">
          <p className="t-label">全員に表示中</p>
          {approved.map((i) => <p key={i.id} className="t-note">・{i.summary}</p>)}
        </div>
      )}
    </section>
  );
}

const describeGap = (clusters: { count: number }[] | undefined) =>
  !clusters || clusters.length === 0 ? "回答なし" : clusters.length === 1 ? "大きなちがいなし" : `理解が${clusters.length}通り`;

/** T1 セッション全体の結果。グループの結果を並べて比べる。指標は分かるものだけ出す */
function ClassResult({ roomId, room, results, summary, onOpen }: { roomId: string; room: Room; results: GroupResult[]; summary: Summary | null; onOpen: (g: number) => void }) {
  const coverage = useDoc<Coverage>(`sessions/${roomId}/results/coverage`).data;
  const respondents = results.reduce((a, r) => a + r.respondents, 0);
  const largest = results.reduce((a, r) => a + Math.max(0, ...r.clusters.map((c) => c.count)), 0);
  const split = results.filter((r) => r.clusters.length > 1).length;
  const source = results[0]?.source ?? summary?.source;
  const signals: { title: string; note: string; value: number | null }[] = [
    { title: "認識一致度", note: "グループごとに、最も多い理解に入った人の割合", value: respondents >= 2 ? largest / respondents : null },
    { title: "意見の反映率", note: "事前意見の論点のうち、議論で取り上げられた割合", value: summary?.metrics.reflectionRate ?? coverage?.reflectionRate ?? null },
    { title: "介入の有効率", note: "承認した提案のうち、その後に取り上げられた割合", value: summary?.metrics.interventionEffectiveness ?? null },
  ];
  const groupCount = room.groups ?? 1;
  return (
    <div className="body">
      <div className="split split--result">
        <div className="stack" style={{ gap: 20 }}>
          <section className="box box--lg box--blue pad stack">
            <div className="heading-row"><p className="t-label">次の授業で扱えそうなこと</p><SourceTag source={source} /></div>
            <p className="t-lg" style={{ lineHeight: 1.4 }}>{split > 0 ? "結論の言葉を、全員でそろえる" : results.length ? "結論の理由を、さらに深める" : "結果を待っています"}</p>
            <p className="t-label">
              {split > 0
                ? `${results.length}グループ中${split}グループで、同じ結論の理解が分かれました。次の授業の始めに「私たちの結論は何のため？」を5分話し合います。`
                : results.length ? "結論の理解はそろっていました。次は、結論を支える理由を一人ひとりが説明できるか確かめます。" : "グループの全員が結論を書くと、ここにまとめが出ます。"}
            </p>
          </section>
          {signals.map((s) => (
            <section key={s.title} className={`box box--sm${s.value !== null && s.value < 0.5 ? " box--pink" : ""}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 17 }}>{s.title}</p>
                <p className="t-small">{s.note}</p>
              </div>
              <p className="t-lg" style={{ whiteSpace: "nowrap" }}>{s.value === null ? <span className="t-small">データなし</span> : `${Math.round(s.value * 100)}%`}</p>
            </section>
          ))}
          <p className="t-small">{source === "mock" ? "数値はデモデータです。" : "数値には Gemini による推定を含みます。"}実測の改善効果とは区別してください。</p>
        </div>
        <section className="box box--lg pad stack">
          <h2 className="t-md">グループを比べる</h2>
          <table className="table table--stack">
            <thead><tr><th>グループ</th><th>認識のちがい</th><th>一致度</th><th>回答</th><th><span className="sr-only">操作</span></th></tr></thead>
            <tbody>
              {Array.from({ length: groupCount }, (_, i) => i + 1).map((g) => {
                const r = results.find((x) => x.group === g);
                return (
                  <tr key={g}>
                    <td className="table__head">グループ{g}</td>
                    <td data-label="認識のちがい">{!r ? "結果待ち" : r.clusters.length > 1 ? <span className="mark">{describeGap(r.clusters)}</span> : describeGap(r.clusters)}</td>
                    <td data-label="一致度">{r ? formatMetric(r.alignmentRate) : "—"}</td>
                    <td data-label="回答">{r ? `${r.respondents}人` : "—"}</td>
                    <td style={{ textAlign: "right" }}>{r && <button className="btn btn--small" onClick={() => onOpen(g)}>詳しく見る</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

/** T2 グループの話し合い。理解の分かれ方、議論の流れ、ここがよかった／ここを見直そう */
function GroupResultView({ result, group, roomId, source }: { result: GroupResult | null; group: number; roomId: string; source?: string }) {
  const clusters = [...(result?.clusters ?? [])].sort((a, b) => b.count - a.count);
  const { flow } = useFlow(roomId, group, source);
  return (
    <div className="body">
      <section className="box box--lg box--yellow pad stack">
        <div className="heading-row"><h2 className="t-label">結論の認識のちがい</h2>{result && <SourceTag source={result.source} />}</div>
        <p className="t-md">{!result ? "このグループの結果はまだありません。" : clusters.length > 1 ? `同じ結論の理解が、${clusters.length}通りに分かれました。` : "結論の理解は、ほぼそろっていました。"}</p>
        <div className="row">
          {clusters.map((c, i) => (
            <div key={i} className="box pad stack stack--tight">
              <p className="t-sm">{c.label}</p>
              <span><Tag tone="tint">{c.count}人の入力</Tag></span>
            </div>
          ))}
        </div>
      </section>
      <FlowTimeline flow={flow} />
      <GoodReview flow={flow} />
      {flow && (flow.teacherSuggestions?.length || flow.review[0]?.question) && (
        <section className="box box--lg box--blue pad stack">
          <div className="heading-row"><h2 className="t-label">次の支援の案</h2><SourceTag source={flow.source} /></div>
          <p className="t-md">{clusters.length > 1 ? "結論の目的を、次の議論の最初に確認する" : "見直したい場面を、次の議論の最初に振り返る"}</p>
          {flow.teacherSuggestions?.length
            ? <ul className="stack stack--tight" style={{ margin: 0, paddingLeft: 20 }}>{flow.teacherSuggestions.map((t, i) => <li key={i} className="t-label">{t}</li>)}</ul>
            : <p className="t-label">問い：{flow.review[0].question}</p>}
        </section>
      )}
    </div>
  );
}
