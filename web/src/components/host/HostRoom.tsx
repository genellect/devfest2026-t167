"use client";
import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { Header, PhaseSteps, SourceTag, Tag, useGeminiSource } from "@/components/ui";
import { ApiError, callApi } from "@/lib/api";
import { formatMetric } from "@/lib/format";
import { getDuration } from "@/lib/local";
import {
  millis, useCountdown, useDoc, useInsights, useMessages,
  type Coverage, type Insight, type Room, type Summary,
} from "@/lib/room";

interface Props { roomId: string; room: Room }
interface Progress { participants: number; opinions: number; statements: number }

/** 先生（PC）の画面。部屋のフェーズで切り替える */
export function HostRoom({ roomId, room }: Props) {
  const source = useGeminiSource();
  const summary = useDoc<Summary>(room.phase === "consensus" || room.phase === "closed" ? `rooms/${roomId}/results/summary` : undefined).data;
  const [phaseError, setPhaseError] = useState("");
  const [moving, setMoving] = useState(false);

  async function advance(to: Room["phase"]) {
    setMoving(true); setPhaseError("");
    try { await callApi(`/rooms/${roomId}/phase`, { to }); }
    catch (e) { setPhaseError((e as Error).message); }
    finally { setMoving(false); }
  }

  const header = (
    <Header eyebrow={room.phase === "closed" ? "議論の結果" : `参加コード ${room.joinCode ?? ""}`} title={room.title} demo={source === "mock"}>
      <PhaseSteps phase={room.phase} />
      {room.phase === "consensus" && summary && (
        <button className="btn btn--small" onClick={() => advance("closed")} disabled={moving}>部屋を閉じる</button>
      )}
    </Header>
  );

  return (
    <main className="screen">
      {header}
      {phaseError && <p className="notice notice--error" role="alert" style={{ margin: "16px 32px 0" }}>{phaseError}</p>}
      {room.phase === "collecting" && <Lobby roomId={roomId} room={room} onStart={() => advance("discussing")} moving={moving} />}
      {room.phase === "discussing" && <Discussion roomId={roomId} room={room} onEnd={() => advance("consensus")} moving={moving} />}
      {room.phase === "consensus" && !summary && <ConsensusWait roomId={roomId} />}
      {(room.phase === "closed" || (room.phase === "consensus" && summary)) && summary && <Result summary={summary} />}
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

/** S3＋S4 参加コード・QR の表示と、事前意見の提出状況 */
function Lobby({ roomId, room, onStart, moving }: { roomId: string; room: Room; onStart: () => void; moving: boolean }) {
  const p = useProgress(roomId);
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
          <p data-testid="join-code" style={{ fontSize: 112, fontWeight: 900, lineHeight: 1.3, letterSpacing: ".04em" }}>{code}</p>
          <p style={{ fontSize: 20 }}>コードを入力するか、QRコードを読み取ってください。</p>
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
          <div className="box box--md pad stack stack--tight">
            <p className="t-label">事前の意見を提出した人</p>
            <p className="t-xl">{p ? `${p.opinions}/${p.participants}人` : "—"}</p>
            <p className="t-small">先生には提出した人数だけを表示します。本文は見えません。</p>
          </div>
          <button className="btn btn--yellow btn--block" onClick={onStart} disabled={moving}>議論を始める</button>
        </div>
      </div>
    </div>
  );
}

/** S5 議論の見守り。残り時間、発言、AI の分析と提案の承認 */
function Discussion({ roomId, room, onEnd, moving }: { roomId: string; room: Room; onEnd: () => void; moving: boolean }) {
  const minutes = getDuration(roomId);
  const timer = useCountdown(millis(room.phaseChangedAt?.discussing), minutes);
  const messages = useMessages(roomId, true);
  const insights = useInsights(roomId, true, false);
  const coverage = useDoc<Coverage>(`rooms/${roomId}/results/coverage`).data;
  const speakers = new Set(messages.map((m) => m.uid)).size;

  return (
    <div className="body" style={{ gap: 24 }}>
      <section className="box box--lg box--blue" style={{ display: "flex", alignItems: "center", gap: 24, padding: "24px 32px" }}>
        <div style={{ flex: 1 }}>
          <p className="t-label">議論の残り時間</p>
          <p style={{ fontSize: 56, fontWeight: 900, lineHeight: 1.2 }} aria-live="off">{timer.over ? "時間です" : timer.text}</p>
        </div>
        <div className="stack stack--tight" style={{ textAlign: "right" }}>
          <p className="t-label">発言 {messages.length}件・発言した人 {speakers}人</p>
          {coverage && <p className="t-label">事前意見の論点の反映率 {formatMetric(coverage.reflectionRate, coverage.source === "mock" ? "mock" : "gemini")}</p>}
        </div>
        <button className="btn btn--yellow" onClick={onEnd} disabled={moving}>議論を終える</button>
      </section>
      <div className="split" style={{ gridTemplateColumns: "minmax(0, 1fr) 460px" }}>
        <section className="box box--md pad stack" style={{ minHeight: 0 }}>
          <h2 className="t-sm">議論の流れ</h2>
          <div className="feed" style={{ maxHeight: "calc(100dvh - 380px)", minHeight: 200 }} aria-live="polite">
            {messages.length === 0 && <p className="empty">発言が届くと、ここに表示されます。</p>}
            {messages.map((m) => <div key={m.id} className="bubble"><p>{m.text}</p></div>)}
          </div>
        </section>
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
function ConsensusWait({ roomId }: { roomId: string }) {
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
          <p className="t-label">生徒が結論を自分の言葉で書いています。全員がそろったら、結果を分析します。</p>
        </div>
        <button className="btn btn--yellow" onClick={analyze} disabled={busy || !p?.statements}>{busy ? "分析中…" : "結果を分析する"}</button>
      </div>
      {error && <p className="notice notice--warn" role="alert">{error}</p>}
      <section className="box box--lg pad-lg stack" style={{ flex: 1, justifyContent: "center", gap: 20 }}>
        <p className="t-md">結論の一文を書いた人</p>
        <p style={{ fontSize: 112, fontWeight: 900, lineHeight: 1.1 }}>{p ? p.statements : "—"}<span className="t-lg"> / {p ? p.participants : "—"}人</span></p>
        <div className="meter" style={{ height: 28 }} aria-hidden="true"><span style={{ width: `${p && p.participants ? (p.statements / p.participants) * 100 : 0}%` }} /></div>
        <p className="t-label">本文は先生にも表示しません。AI が、同じ結論の理解がどう分かれたかだけをまとめます。</p>
      </section>
    </div>
  );
}

/** S7 結果。4つの指標と、合意の理解の分かれ方 */
function Result({ summary }: { summary: Summary }) {
  const m = summary.metrics;
  const src = summary.source === "mock" ? "mock" : "gemini";
  const groups = [...summary.groups].sort((a, b) => b.members.length - a.members.length);
  const headline = groups.length > 1
    ? [`全員が「賛成」でも、`, `結論の理解は${groups.length}通りに分かれた。`]
    : [`結論の理解は、`, `ほぼそろっていた。`];
  const signals: { title: string; note: string; value: number | null }[] = [
    { title: "意見の反映率", note: "事前意見の論点のうち、議論で取り上げられた割合", value: m.reflectionRate },
    { title: "認識一致度", note: "最も多い理解に入った人の割合", value: m.alignmentRate },
    { title: "参加の公平性", note: "発言数の偏りの少なさ（全員同じなら100%）", value: m.participationFairness },
    { title: "介入の有効率", note: "承認した提案のうち、その後の議論で取り上げられた割合", value: m.interventionEffectiveness },
  ];
  return (
    <div className="body">
      <div className="split">
        <div className="stack" style={{ gap: 24 }}>
          <section className="box box--lg box--blue pad-lg stack">
            <p className="t-hero">{headline[0]}<br />{headline[1]}</p>
            <p className="t-label" style={{ fontSize: 19 }}>{summary.respondents}人の回答から。個人の名前は表示しません。</p>
          </section>
          <section className="box box--md pad stack" style={{ flex: 1 }}>
            <div className="heading-row"><h2 className="t-md">結論の理解の分かれ方</h2><SourceTag source={summary.source} /></div>
            {groups.length === 0 && <p className="empty">回答がありませんでした。</p>}
            {groups.map((g, i) => (
              <div key={i} className="stack stack--tight">
                <div className="heading-row"><p className="t-sm">{g.label}</p><p className="t-sm">{g.members.length}人</p></div>
                <div className="meter" aria-hidden="true"><span style={{ width: `${summary.respondents ? (g.members.length / summary.respondents) * 100 : 0}%`, background: i === 0 ? "var(--c-blue)" : "var(--c-yellow)" }} /></div>
              </div>
            ))}
            {groups.length > 1 && <p className="t-label">次の議論の最初に「この結論は何のため？」を確かめると、ずれを話し合えます。</p>}
          </section>
        </div>
        <div className="stack" style={{ gap: 16 }}>
          {signals.map((s) => (
            <section key={s.title} className={`box box--md${s.value !== null && s.value < 0.5 ? " box--pink" : ""}`}
              style={{ flex: 1, display: "flex", alignItems: "center", gap: 12, padding: "12px 20px" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 18 }}>{s.title}</p>
                <p className="t-small">{s.note}</p>
              </div>
              <p className="t-xl" style={{ whiteSpace: "nowrap" }}>{s.value === null ? <span className="t-sm">データなし</span> : `${Math.round(s.value * 100)}%`}</p>
            </section>
          ))}
          <p className="t-small">{src === "mock" ? "数値はデモデータです。" : "数値には Gemini による推定を含みます。"}実測の改善効果とは区別してください。</p>
        </div>
      </div>
    </div>
  );
}
