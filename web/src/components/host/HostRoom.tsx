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
  millis, useCountdown, useDoc, useInsights,
  type Coverage, type Insight, type Progress, type Room, type Summary,
} from "@/lib/room";

interface Props { roomId: string; room: Room }

/** 先生（PC）の画面。部屋のフェーズで切り替える */
export function HostRoom({ roomId, room }: Props) {
  const source = useGeminiSource();
  const summary = useDoc<Summary>(room.phase === "consensus" || room.phase === "closed" ? `rooms/${roomId}/results/summary` : undefined).data;
  const [phaseError, setPhaseError] = useState("");
  const [moving, setMoving] = useState(false);
  const [openGroup, setOpenGroup] = useState<number>();

  async function advance(to: Room["phase"]) {
    setMoving(true); setPhaseError("");
    try { await callApi(`/rooms/${roomId}/phase`, { to }); }
    catch (e) { setPhaseError((e as Error).message); }
    finally { setMoving(false); }
  }

  const showResult = !!summary && (room.phase === "closed" || room.phase === "consensus");
  const [label, setLabel] = useState("");
  useEffect(() => { setLabel(getRoomLabel(roomId)); }, [roomId]);
  const eyebrow = showResult
    ? (openGroup ? `クラス全体 ＞ グループ${openGroup}` : `${label ? `${label}　` : ""}議論の結果`)
    : `${label ? `${label}　` : ""}参加コード ${room.joinCode ?? ""}`;
  return (
    <main className="screen">
      <Header eyebrow={eyebrow} title={showResult && openGroup ? `グループ${openGroup}の話し合い` : room.title} demo={source === "mock"}>
        <PhaseSteps phase={room.phase} />
        {!openGroup && <Link className="btn btn--small" href="/host">ホーム</Link>}
        {showResult && openGroup && <button className="btn btn--small" onClick={() => setOpenGroup(undefined)}>クラス全体に戻る</button>}
        {room.phase === "consensus" && summary && (
          <button className="btn btn--small" onClick={() => advance("closed")} disabled={moving}>部屋を閉じる</button>
        )}
      </Header>
      {phaseError && <p className="notice notice--error" role="alert" style={{ margin: "16px 32px 0" }}>{phaseError}</p>}
      {room.phase === "collecting" && <Lobby roomId={roomId} room={room} onStart={() => advance("discussing")} moving={moving} />}
      {room.phase === "discussing" && <Discussion roomId={roomId} room={room} onEnd={() => advance("consensus")} moving={moving} />}
      {room.phase === "consensus" && !summary && <ConsensusWait roomId={roomId} room={room} />}
      {showResult && summary && !openGroup && <ClassResult summary={summary} groups={room.groups ?? 1} onOpen={setOpenGroup} roomId={roomId} source={source} />}
      {showResult && summary && openGroup && <GroupResult summary={summary} group={openGroup} roomId={roomId} source={source} />}
      {room.phase === "closed" && !summary && (
        <div className="body body--center"><p className="box box--md pad t-label">この議論は、結果を分析しないまま終了しました。</p></div>
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
            <h2 className="t-lg">{p ? `${p.opinions}/${p.participants}人が提出しました` : "提出状況を確認しています…"}</h2>
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
            <p className="t-xl">{p ? `${p.participants}人` : "—"}</p>
          </div>
          <button className="btn btn--yellow btn--block" onClick={() => setView("status")}>事前の記入状況を見る</button>
        </div>
      </div>
    </div>
  );
}

/** S5 議論の見守り。残り時間、グループの様子、AI の分析と提案の承認 */
function Discussion({ roomId, room, onEnd, moving }: { roomId: string; room: Room; onEnd: () => void; moving: boolean }) {
  const minutes = getDuration(roomId);
  const timer = useCountdown(millis(room.phaseChangedAt?.discussing), minutes);
  const insights = useInsights(roomId, true, false);
  const coverage = useDoc<Coverage>(`rooms/${roomId}/results/coverage`).data;
  const p = useProgress(roomId);

  return (
    <div className="body" style={{ gap: 24 }}>
      <section className="box box--lg box--blue" style={{ display: "flex", alignItems: "center", gap: 24, padding: "24px 32px" }}>
        <div style={{ flex: 1 }}>
          <p className="t-label">議論の残り時間</p>
          <p style={{ fontSize: 56, fontWeight: 900, lineHeight: 1.2 }} aria-live="off">{timer.over ? "時間です" : timer.text}</p>
        </div>
        {coverage && <p className="t-label">事前意見の論点の反映率 {formatMetric(coverage.reflectionRate, coverage.source === "mock" ? "mock" : "gemini")}</p>}
        <button className="btn btn--yellow" onClick={onEnd} disabled={moving}>議論を終える</button>
      </section>
      <div className="split" style={{ gridTemplateColumns: "minmax(0, 1fr) 420px" }}>
        <GroupGrid p={p} render={(g) => ({ big: "話し合い中", note: `${g.participants}人・各端末で録音中` })} />
        <AiPanel roomId={roomId} room={room} insights={insights} />
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

/** S6 合意の回答待ち */
function ConsensusWait({ roomId, room }: { roomId: string; room: Room }) {
  const p = useProgress(roomId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function analyze() {
    setBusy(true); setError("");
    try { await callApi(`/rooms/${roomId}/consensus/analyze`); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return (
    <div className="body">
      <div style={{ display: "flex", alignItems: "flex-end", gap: 24 }}>
        <div style={{ flex: 1 }}>
          <h2 className="t-lg">{p ? `${p.statements}/${p.participants}人が提出しました` : "提出状況を確認しています…"}</h2>
          <p className="t-label">全員がそろったら、結果を分析します。本文は先生にも表示しません。</p>
        </div>
        <button className="btn btn--yellow" onClick={analyze} disabled={busy || !p?.statements}>{busy ? "分析中…" : "結果を分析する"}</button>
      </div>
      {error && <p className="notice notice--warn" role="alert">{error}</p>}
      {(room.groups ?? 1) > 1 ? (
        <GroupGrid p={p} render={(g) => ({ big: `${g.statements}/${g.participants}人`, note: "結論の一文を提出済み", done: g.participants > 0 && g.statements === g.participants })} />
      ) : (
        <section className="box box--lg pad-lg stack" style={{ flex: 1, justifyContent: "center", gap: 20 }}>
          <p className="t-md">結論の一文を書いた人</p>
          <p style={{ fontSize: 112, fontWeight: 900, lineHeight: 1.1 }}>{p ? p.statements : "—"}<span className="t-lg"> / {p ? p.participants : "—"}人</span></p>
          <div className="meter" style={{ height: 28 }} aria-hidden="true"><span style={{ width: `${p && p.participants ? (p.statements / p.participants) * 100 : 0}%` }} /></div>
        </section>
      )}
    </div>
  );
}

const describeGap = (clusters: { count: number }[] | undefined) =>
  !clusters || clusters.length === 0 ? "回答なし" : clusters.length === 1 ? "大きなちがいなし" : `理解が${clusters.length}通り`;

/** T1 クラス全体の結果。4つの指標と、グループの比較 */
function ClassResult({ summary, groups, onOpen }: { summary: Summary; groups: number; onOpen: (g: number) => void; roomId: string; source?: string }) {
  const m = summary.metrics;
  const byGroup = summary.byGroup ?? [{ group: 1, respondents: summary.respondents, alignmentRate: m.alignmentRate, clusters: summary.groups.map((g) => ({ label: g.label, count: g.members.length })) }];
  const split = byGroup.filter((g) => g.clusters.length > 1).length;
  const signals: { title: string; note: string; value: number | null }[] = [
    { title: "意見の反映率", note: "事前意見の論点のうち、議論で取り上げられた割合", value: m.reflectionRate },
    { title: "認識一致度", note: "最も多い理解に入った人の割合", value: m.alignmentRate },
    { title: "参加の公平性", note: "発言数の偏りの少なさ（全員同じなら100%）", value: m.participationFairness },
    { title: "介入の有効率", note: "承認した提案のうち、その後に取り上げられた割合", value: m.interventionEffectiveness },
  ];
  return (
    <div className="body">
      <div style={{ display: "grid", gridTemplateColumns: "380px minmax(0, 1fr)", gap: 28 }}>
        <div className="stack" style={{ gap: 20 }}>
          <section className="box box--lg box--blue pad stack">
            <div className="heading-row"><p className="t-label">次の授業で扱えそうなこと</p><SourceTag source={summary.source} /></div>
            <p className="t-lg" style={{ lineHeight: 1.4 }}>{split > 0 ? "結論の言葉を、全員でそろえる" : "結論の理由を、さらに深める"}</p>
            <p className="t-label">
              {split > 0
                ? `${groups > 1 ? `${byGroup.length}グループ中${split}グループで、` : ""}同じ結論の理解が分かれました。次の授業の始めに「私たちの結論は何のため？」を5分話し合います。`
                : "結論の理解はそろっていました。次は、結論を支える理由を一人ひとりが説明できるか確かめます。"}
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
          <p className="t-small">{summary.source === "mock" ? "数値はデモデータです。" : "数値には Gemini による推定を含みます。"}実測の改善効果とは区別してください。</p>
        </div>
        <section className="box box--lg pad stack">
          <h2 className="t-md">グループを比べる</h2>
          <table className="table">
            <thead><tr><th>グループ</th><th>認識のちがい</th><th>一致度</th><th>回答</th><th /></tr></thead>
            <tbody>
              {byGroup.map((g) => (
                <tr key={g.group}>
                  <td style={{ fontWeight: 900 }}>グループ{g.group}</td>
                  <td>{g.clusters.length > 1 ? <span className="mark">{describeGap(g.clusters)}</span> : describeGap(g.clusters)}</td>
                  <td>{formatMetric(g.alignmentRate)}</td>
                  <td>{g.respondents}人</td>
                  <td style={{ textAlign: "right" }}><button className="btn btn--small" onClick={() => onOpen(g.group)}>詳しく見る</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

/** T2 グループの話し合い。理解の分かれ方、議論の流れ、ここがよかった／ここを見直そう */
function GroupResult({ summary, group, roomId, source }: { summary: Summary; group: number; roomId: string; source?: string }) {
  const g = summary.byGroup?.find((x) => x.group === group);
  const clusters = [...(g?.clusters ?? summary.groups.map((c) => ({ label: c.label, count: c.members.length })))].sort((a, b) => b.count - a.count);
  const { flow } = useFlow(roomId, group, source);
  return (
    <div className="body">
      <section className="box box--lg box--yellow pad stack">
        <div className="heading-row"><h2 className="t-label">結論の認識のちがい</h2><SourceTag source={summary.source} /></div>
        <p className="t-md">{clusters.length > 1 ? `同じ結論の理解が、${clusters.length}通りに分かれました。` : clusters.length === 1 ? "結論の理解は、ほぼそろっていました。" : "このグループの回答はありませんでした。"}</p>
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
