"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FlowTimeline, GoodReview, useFlow } from "@/components/flow";
import { FlowSpeaking } from "@/components/FlowSpeaking";
import { SourceTag, Tag } from "@/components/ui";
import { callApi } from "@/lib/api";
import { formatMetric } from "@/lib/format";
import { getReflection, saveReflection } from "@/lib/local";
import { useDoc, useMessages, type GroupResult } from "@/lib/room";

// 通常の参加フローで使う意見・結論・振り返りの部品

/** 旧フローでは画面の中央に置き、新しい流れでは親の列にそのまま並べる */
function Wrap({ bare, children }: { bare: boolean; children: React.ReactNode }) {
  return bare ? <>{children}</> : <div className="body body--center">{children}</div>;
}
/** 議論で出た発言を短く共有する。AI はこのメモと事前の意見を照らし合わせて、まだ話されていない論点を探す */
export function DiscussionNotes({ roomId, bare = false }: { roomId: string; bare?: boolean }) {
  const messages = useMessages(roomId, true);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true); setError("");
    try { await callApi(`/rooms/${roomId}/messages`, { text: text.trim() }); setText(""); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <section className={bare ? "flow-card" : "box box--md pad stack"} aria-label="議論の発言メモ">
      <div className="heading-row"><h2 className="t-sm">議論の発言メモ</h2><Tag>グループと教員に表示</Tag></div>
      <p className="t-note">話し合いで出た意見を短く書きます。AIはこのメモと事前の意見を照らし合わせて、まだ話されていない論点を探します。</p>
      {messages.slice(-8).map((m) => <p key={m.id} className="t-small">・{m.text}</p>)}
      <form className="stack stack--tight" onSubmit={send}>
        <label className="field__label" htmlFor="note">発言を書く</label>
        <input id="note" className="input" maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn btn--small" disabled={busy || !text.trim()}>{busy ? "共有しています…" : "メモを共有する"}</button>
      </form>
      {error && <p className="notice notice--error" role="alert">{error}</p>}
    </section>
  );
}

const AGREEMENT = ["まったく納得していない", "あまり納得していない", "どちらともいえない", "おおむね納得", "とても納得"];

/** P4 結論の理解を入力。本人だけが読み書きできる */
export function ConsensusStep({ roomId, uid, title, submitted, total, bare = false }: { roomId: string; uid: string; title: string; submitted?: number; total?: number; bare?: boolean }) {
  const mine = useDoc<{ text: string; agreement: number; concern?: string }>(`sessions/${roomId}/consensusStatements/${uid}`).data;
  const [text, setText] = useState("");
  const [agreement, setAgreement] = useState(0);
  const [concern, setConcern] = useState("");
  const [error, setError] = useState("");
  const loaded = useRef(false);
  useEffect(() => {
    if (mine && !loaded.current) { loaded.current = true; setText(mine.text); setAgreement(mine.agreement); setConcern(mine.concern ?? ""); }
  }, [mine]);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError("");
    try {
      // API 経由で出す。グループ全員がそろうと、API がそのグループの結果を出す
      await callApi(`/rooms/${roomId}/statement`, { text: text.trim(), agreement, ...(concern.trim() ? { concern: concern.trim() } : {}) });
    } catch (err) { setError(`提出できませんでした：${(err as Error).message}`); }
  }

  return (
    <Wrap bare={bare}>
      <form className={bare ? "flow-card" : "box box--lg card"} onSubmit={submit}>
        <h2 className="card__title">結論を自分の言葉で書く</h2>
        <div className="box box--tint" style={{ padding: "10px 14px" }}>
          <p className="t-small" style={{ fontWeight: 700 }}>議論のテーマ</p>
          <p className="t-md">{title}</p>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="stmt">グループの結論を、あなたはどう理解した？</label>
          <textarea id="stmt" className="input" rows={2} maxLength={300} value={text} placeholder="例：将来の仕事に役立つ経験を増やすこと" onChange={(e) => setText(e.target.value)} />
          <p className="field__hint">正解はありません。あなたの言葉で一文で書いてください。</p>
        </div>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field__label" style={{ marginBottom: 6 }}>その結論に、どのくらい納得している？</legend>
          <div className="choices choices--scale">
            {AGREEMENT.map((label, i) => (
              <button key={label} type="button" className="choice" aria-pressed={agreement === i + 1} onClick={() => setAgreement(i + 1)}>{label}</button>
            ))}
          </div>
        </fieldset>
        <div className="field">
          <label className="field__label" htmlFor="concern">まだ気になっていること（なくても大丈夫）</label>
          <input id="concern" className="input" maxLength={300} value={concern} onChange={(e) => setConcern(e.target.value)} />
        </div>
        {error && <p className="notice notice--error" role="alert">{error}</p>}
        <button className="btn btn--blue btn--block" type="submit" disabled={!text.trim() || !agreement}>{mine ? "書き直して提出する" : "提出する"}</button>
        {mine && (
          <div className="notice notice--warn stack stack--tight" role="status">
            <p className="t-label">提出しました。グループのみんなを待っています{total ? `（${submitted ?? 0}/${total}人）` : ""}</p>
            <p className="t-note">全員がそろうと、自動で結果の画面に変わります。</p>
          </div>
        )}
      </form>
    </Wrap>
  );
}

const SPOKE = ["言えた", "一部言えた", "言えなかった", "特になかった"];

/** P4-2 認識のちがい ＋ P5 振り返り。グループの結果は全員に、振り返りはこの端末にだけ残す */
export function ResultStep({ roomId, uid, group, title, result, showSpeaking = false }: { roomId: string; uid: string; group: number; source?: string; title: string; result: GroupResult | null; showSpeaking?: boolean }) {
  const mine = useDoc<{ text: string }>(`sessions/${roomId}/consensusStatements/${uid}`).data;
  const opinion = useDoc<{ text: string }>(`sessions/${roomId}/privateOpinions/${uid}`).data;
  const [r, setR] = useState(() => getReflection(roomId));
  const [saved, setSaved] = useState(false);
  const set = (patch: Partial<typeof r>) => { setR({ ...r, ...patch }); setSaved(false); };
  const groups = [...(result?.clusters ?? [])].sort((a, b) => b.count - a.count).map((c) => ({ label: c.label, n: c.count }));
  const alignment = result?.alignmentRate ?? null;
  const { flow } = useFlow(roomId, group);

  return (
    <div className="body body--tablet">
      <section className="box box--md box--blue pad">
        <p className="t-label">議論のテーマ</p>
        <p className="t-lg">{title}</p>
      </section>

      <h2 className="t-md">同じ結論を、どう理解した？</h2>
      {!result ? (
        <p className="box box--sm pad t-label">グループの結果はまだありません。グループ全員が結論の一文を書くと、ここに理解の分かれ方が出ます。</p>
      ) : (
        <div className="row">
          <section className="box box--sm box--yellow pad stack">
            <div className="heading-row"><h3 className="t-sm">あなたの理解</h3><Tag tone="tint">あなたの入力</Tag></div>
            <p className="t-md">{mine?.text ?? "（入力していません）"}</p>
          </section>
          <section className="box box--sm pad stack">
            <div className="heading-row"><h3 className="t-sm">グループの理解の分かれ方</h3><SourceTag source={result.source} /></div>
            <p className="t-md">{groups.length <= 1 ? "理解はほぼそろっていました。" : `${groups.length}通りに分かれました。`}</p>
            <ul className="stack stack--tight" style={{ margin: 0, paddingLeft: 20 }}>
              {groups.map((g, i) => <li key={i} className="t-label">{g.label}（{g.n}人）</li>)}
            </ul>
            <p className="t-note">認識一致度：{formatMetric(alignment, result.source === "mock" ? "mock" : "gemini")}</p>
          </section>
        </div>
      )}

      {(
        <>
          {/* 録音の分析も、教員が許可した発言の集計もないときは、空の欄を出さない */}
          {(flow || showSpeaking) && <>
            <h2 className="t-md">グループで何が起きたか</h2>
            {showSpeaking ? <FlowSpeaking roomId={roomId} group={group} flow={flow} /> : <FlowTimeline flow={flow} compact />}
          </>}
          <h2 className="t-md">自分はどう関わっていたか</h2>
          <div className="row">
            <section className="box box--sm pad stack">
              {opinion && (
                <div className="box box--tint" style={{ padding: "8px 12px" }}>
                  <p className="t-small" style={{ fontWeight: 700 }}>事前の意見</p>
                  <p>{opinion.text}</p>
                </div>
              )}
              <p className="t-label">言いたいことは言えた？</p>
              <div className="choices">
                {SPOKE.map((x) => <button key={x} type="button" className="choice" aria-pressed={r.spoke === x} onClick={() => set({ spoke: x })}>{x}</button>)}
              </div>
            </section>
            <section className="box box--sm box--blue pad stack">
              <h3 className="t-sm">自分の言葉で書く</h3>
              <div className="field">
                <label className="field__label" htmlFor="again">もう一度話すなら、どうする？</label>
                <input id="again" className="input" style={{ color: "#000" }} value={r.ifAgain ?? ""} maxLength={120} placeholder="例：事前の意見を最初に話す" onChange={(e) => set({ ifAgain: e.target.value })} />
              </div>
              <button type="button" className="btn btn--blue" style={{ alignSelf: "flex-end" }}
                onClick={() => { saveReflection(roomId, { ...r, savedAt: Date.now() }); setSaved(true); }}>振り返りを保存</button>
              {saved && <p role="status">この端末に保存しました。</p>}
            </section>
          </div>
          <h2 className="t-md">次はどうするか</h2>
          <GoodReview flow={flow} />
          <Link className="btn" href="/home" style={{ alignSelf: "flex-start" }}>ホームに戻る</Link>
        </>
      )}
    </div>
  );
}
