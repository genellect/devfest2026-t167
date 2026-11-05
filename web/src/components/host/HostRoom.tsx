"use client";
import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { FlowTimeline, GoodReview, useFlow } from "@/components/flow";
import { Header, PhaseSteps, SourceTag, Tag, useGeminiSource } from "@/components/ui";
import { ApiError, callApi } from "@/lib/api";
import { formatMetric } from "@/lib/format";
import Link from "next/link";
import { getDuration, getRoomLabel } from "@/lib/local";
import {
  millis, useCountdown, useDoc, useGroupResults, useInsights, useMembers,
  type Coverage, type GroupResult, type Insight, type Progress, type Room, type Summary,
} from "@/lib/room";

interface Props { roomId: string; room: Room }

/** 先生（PC）の画面。事前意見 → 議論のダッシュボード（グループの進み具合と結果）→ クラス全体の結果 */
export function HostRoom({ roomId, room }: Props) {
  const source = useGeminiSource();
  const summary = useDoc<Summary>(room.phase === "consensus" || room.phase === "closed" ? `rooms/${roomId}/results/summary` : undefined).data;
  const results = useGroupResults(roomId, room.phase !== "collecting");
  const [phaseError, setPhaseError] = useState("");
  const [moving, setMoving] = useState(false);
  const [view, setView] = useState<"dashboard" | "class" | number>("dashboard");

  async function advance(...to: Room["phase"][]) {
    setMoving(true); setPhaseError("");
    try { for (const p of to) await callApi(`/rooms/${roomId}/phase`, { to: p }); }
    catch (e) { setPhaseError((e as Error).message); }
    finally { setMoving(false); }
  }

  const [label, setLabel] = useState("");
  useEffect(() => { setLabel(getRoomLabel(roomId)); }, [roomId]);
  const closed = room.phase === "closed";
  const current = closed && view === "dashboard" ? "class" : view;
  const eyebrow = typeof current === "number"
    ? `クラス全体 ＞ グループ${current}`
    : `${label ? `${label}　` : ""}${current === "class" ? "クラス全体の結果" : `参加コード ${room.joinCode ?? ""}`}`;
  return (
    <main className="screen">
      <Header eyebrow={eyebrow} title={typeof current === "number" ? `グループ${current}の話し合い` : room.title} demo={source === "mock"}>
        <PhaseSteps phase={room.phase} />
        {current !== "dashboard" && !(closed && current === "class") && (
          <button className="btn btn--small" onClick={() => setView(typeof current === "number" && closed ? "class" : "dashboard")}>
            {typeof current === "number" && closed ? "クラス全体に戻る" : "ダッシュボードに戻る"}
          </button>
        )}
        {current === "dashboard" && room.phase !== "collecting" && results.length > 0 && (
          <button className="btn btn--small" onClick={() => setView("class")}>クラス全体の結果</button>
        )}
        <Link className="btn btn--small" href="/host">ホーム</Link>
      </Header>
      {phaseError && <p className="notice notice--error" role="alert" style={{ margin: "16px 32px 0" }}>{phaseError}</p>}
      {room.phase === "collecting" && <Lobby roomId={roomId} room={room} onStart={() => advance("discussing")} moving={moving} />}
      {(room.phase === "discussing" || room.phase === "consensus") && current === "dashboard" && (
        <Dashboard roomId={roomId} room={room} results={results} onOpen={setView} moving={moving}
          onClose={() => advance(...(room.phase === "discussing" ? ["consensus", "closed"] as const : ["closed"] as const))} />
      )}
      {room.phase !== "collecting" && current === "class" && <ClassResult roomId={roomId} room={room} results={results} summary={summary ?? null} onOpen={setView} />}
      {room.phase !== "collecting" && typeof current === "number" && (
        <GroupResultView result={results.find((r) => r.group === current) ?? null} group={current} roomId={roomId} source={source} />
      )}
    </main>
  );
}

/** 提出状況を数秒ごとに取り直す。本文は API から返らない（件数だけ） */
function useProgress(roomId: string) {
  const [p, setP] = useState<Progress>();
  const load = useCallback(() => callApi<Progress>(`/rooms/${roomId}/progress`).then(setP).catch(() => {}), [roomId]);
  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, [load]);
  return p;
}

/** グループごとのカードの並び。status は各グループの状態を1行で返す */
function GroupGrid({ p, render }: { p?: Progress; render: (g: NonNullable<Progress["byGroup"]>[number]) => { big: string; note: string; done?: boolean } }) {
  if (!p?.byGroup) return <p className="empty">グループの状況を確認しています…</p>;
  return (
    <div className="grid-auto">
      {p.byGroup.map((g) => {
        const r = render(g);
        return (
          <section key={g.group} className={`box box--md group-card${r.done ? " box--tint" : ""}`}>
            <p className="t-label">グループ{g.group}</p>
            <p className="t-lg">{r.big}</p>
            <p className="t-small">{r.note}</p>
          </section>
        );
      })}
    </div>
  );
}

/** S3 参加コード・QR の表示 → S4 事前意見の提出状況 */
function Lobby({ roomId, room, onStart, moving }: { roomId: string; room: Room; onStart: () => void; moving: boolean }) {
  const p = useProgress(roomId);
  // 参加者の数は Firestore の購読で数える（提出数だけ API の progress を使う）
  const joined = useMembers(roomId, true).filter((m) => m.role === "participant").length;
  const [qr, setQr] = useState<string>();
  const [view, setView] = useState<"code" | "status">("code");
  const code = room.joinCode ?? "";
  useEffect(() => {
    if (!code) return;
    QRCode.toDataURL(`${window.location.origin}/join?code=${code}`, { margin: 1, width: 520, color: { dark: "#000000", light: "#ffffff" } })
      .then(setQr).catch(() => setQr(undefined));
  }, [code]);

  if (view === "status") {
    return (
      <div className="body">
        <div style={{ display: "flex", alignItems: "flex-end", gap: 16 }}>
          <div style={{ flex: 1 }}>
            <h2 className="t-lg">{p ? `${p.opinions}/${p.participants}人が提出しました` : `${joined}人が参加しています`}</h2>
            <p className="t-label">先生には提出した人数だけを表示します。本文は見えません。</p>
          </div>
          <button className="btn" onClick={() => setView("code")}>参加コードを表示</button>
          <button className="btn btn--yellow" onClick={onStart} disabled={moving}>議論を始める</button>
        </div>
        <GroupGrid p={p} render={(g) => ({ big: `${g.opinions}/${g.participants}人`, note: "提出済み", done: g.participants > 0 && g.opinions === g.participants })} />
      </div>
    );
  }
  return (
    <div className="body">
      <div className="split">
        <section className="box box--lg box--blue pad-lg stack" style={{ justifyContent: "center", gap: 12 }}>
          <p className="t-md" style={{ fontWeight: 700 }}>参加コード</p>
          <p data-testid="join-code" style={{ fontSize: 112, fontWeight: 900, lineHeight: 1.3, letterSpacing: ".04em" }}>{code}</p>
          <p style={{ fontSize: 20 }}>コードを入力するか、QRコードを読み取ってください。</p>
          {(room.groups ?? 1) > 1 && <p className="t-label">参加した順に、{room.groups}つのグループに分かれます。</p>}
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
          <button className="btn btn--yellow btn--block" onClick={() => setView("status")}>事前の記入状況を見る</button>
        </div>
      </div>
    </div>
  );
}

/** S5 議論のダッシュボード。残り時間、グループの進み具合（議論中・記入中・結果あり）、AI の提案 */
function Dashboard({ roomId, room, results, onOpen, onClose, moving }: {
  roomId: string; room: Room; results: GroupResult[]; onOpen: (g: number) => void; onClose: () => void; moving: boolean;
}) {
  const minutes = getDuration(roomId);
  const timer = useCountdown(millis(room.phaseChangedAt?.discussing), minutes);
  const insights = useInsights(roomId, true, false);
  const coverage = useDoc<Coverage>(`rooms/${roomId}/results/coverage`).data;
  const members = useMembers(roomId, true).filter((m) => m.role === "participant");
  const [confirm, setConfirm] = useState(false);
  const [busyGroup, setBusyGroup] = useState<number>();
  const [error, setError] = useState("");
  const groupCount = room.groups ?? 1;
  const done = results.length;

  async function analyzeNow(g: number) {
    setBusyGroup(g); setError("");
    try { await callApi(`/rooms/${roomId}/groups/analyze`, { group: g }); }
    catch (e) { setError((e as Error).message); }
    finally { setBusyGroup(undefined); }
  }

  return (
    <div className="body" style={{ gap: 24 }}>
      <section className="box box--lg box--blue" style={{ display: "flex", alignItems: "center", gap: 24, padding: "24px 32px" }}>
        <div style={{ flex: 1 }}>
          <p className="t-label">議論の残り時間</p>
          <p style={{ fontSize: 56, fontWeight: 900, lineHeight: 1.2 }} aria-live="off">{timer.over ? "時間です" : timer.text}</p>
        </div>
        <div className="stack stack--tight" style={{ textAlign: "right" }}>
          <p className="t-label">結果が出たグループ {done}/{groupCount}</p>
          {coverage && <p className="t-label">事前意見の論点の反映率 {formatMetric(coverage.reflectionRate, coverage.source === "mock" ? "mock" : "gemini")}</p>}
        </div>
        {!confirm
          ? <button className="btn btn--yellow" onClick={() => setConfirm(true)} disabled={moving}>授業を終える</button>
          : (
            <div className="stack stack--tight">
              <button className="btn btn--yellow" onClick={onClose} disabled={moving}>終えて結果を見る</button>
              <button className="btn btn--small" onClick={() => setConfirm(false)} disabled={moving}>まだ続ける</button>
            </div>
          )}
      </section>
      {error && <p className="notice notice--warn" role="alert">{error}</p>}
      <div className="split" style={{ gridTemplateColumns: "minmax(0, 1fr) 420px" }}>
        <div className="grid-auto">
          {Array.from({ length: groupCount }, (_, i) => i + 1).map((g) => {
            const st = room.groupState?.[String(g)];
            const result = results.find((r) => r.group === g);
            const n = members.filter((m) => (m.group ?? 1) === g).length;
            const writing = !result && (st?.status === "consensus" || room.phase === "consensus");
            return (
              <section key={g} className={`box box--md group-card${result ? " box--tint" : writing ? " box--yellow" : ""}`}>
                <p className="t-label">グループ{g}</p>
                <p className="t-lg">{result ? "結果あり" : writing ? "結論を記入中" : "話し合い中"}</p>
                <p className="t-small">
                  {writing ? `提出 ${st?.submitted ?? 0}/${st?.total ?? n}人` : `${n}人`}
                  {result && result.clusters.length > 1 ? `・理解が${result.clusters.length}通り` : ""}
                </p>
                {result && <button className="btn btn--small" style={{ alignSelf: "flex-start", marginTop: 6 }} onClick={() => onOpen(g)}>詳しく見る</button>}
                {writing && (st?.submitted ?? 0) > 0 && (
                  <button className="btn btn--small" style={{ alignSelf: "flex-start", marginTop: 6 }} onClick={() => analyzeNow(g)} disabled={busyGroup === g}>
                    {busyGroup === g ? "分析中…" : "今の回答で結果を出す"}
                  </button>
                )}
              </section>
            );
          })}
        </div>
        {room.phase === "discussing" ? <AiPanel roomId={roomId} room={room} insights={insights} /> : (
          <section className="box box--md pad stack"><p className="t-label">全員が結論を書いています。</p><p className="t-note">グループごとに、全員がそろうと結果が出ます。</p></section>
        )}
      </div>
    </div>
  );
}

/** AI の分析ボタンと介入提案。提案は先生が承認したものだけが生徒に届く */
function AiPanel({ roomId, room, insights }: { roomId: string; room: Room; insights: Insight[] }) {
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState("");
  const [wait, setWait] = useState(0);
  const [msg, setMsg] = useState("");
  const running = busy || room.analysis?.status === "running";

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
        <div className="heading-row"><h2 className="t-sm">AIからの介入提案</h2><Tag>先生だけに表示</Tag></div>
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

/** T1 クラス全体の結果。グループの結果を並べて比べる。指標は分かるものだけ出す */
function ClassResult({ roomId, room, results, summary, onOpen }: { roomId: string; room: Room; results: GroupResult[]; summary: Summary | null; onOpen: (g: number) => void }) {
  const coverage = useDoc<Coverage>(`rooms/${roomId}/results/coverage`).data;
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
      <div style={{ display: "grid", gridTemplateColumns: "380px minmax(0, 1fr)", gap: 28 }}>
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
          <table className="table">
            <thead><tr><th>グループ</th><th>認識のちがい</th><th>一致度</th><th>回答</th><th /></tr></thead>
            <tbody>
              {Array.from({ length: groupCount }, (_, i) => i + 1).map((g) => {
                const r = results.find((x) => x.group === g);
                return (
                  <tr key={g}>
                    <td style={{ fontWeight: 900 }}>グループ{g}</td>
                    <td>{!r ? "結果待ち" : r.clusters.length > 1 ? <span className="mark">{describeGap(r.clusters)}</span> : describeGap(r.clusters)}</td>
                    <td>{r ? formatMetric(r.alignmentRate) : "—"}</td>
                    <td>{r ? `${r.respondents}人` : "—"}</td>
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
      {flow?.review[0]?.question && (
        <section className="box box--lg box--blue pad stack">
          <div className="heading-row"><h2 className="t-label">次の支援の案</h2><SourceTag source={flow.source} /></div>
          <p className="t-md">{clusters.length > 1 ? "結論の目的を、次の議論の最初に確認する" : "見直したい場面を、次の議論の最初に振り返る"}</p>
          <p className="t-label">問い：{flow.review[0].question}</p>
        </section>
      )}
    </div>
  );
}
