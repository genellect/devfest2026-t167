"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FlowTimeline, GoodReview, useFlow } from "@/components/flow";
import { FlowSpeaking } from "@/components/FlowSpeaking";
import { SourceTag, Tag } from "@/components/ui";
import { describeUnderstanding } from "@/components/understandings";
import { callApi } from "@/lib/api";
import { formatMetric } from "@/lib/format";
import { getNextGoal, getReflection, saveReflection } from "@/lib/local";
import { useDoc, useMessages, type GroupResult } from "@/lib/room";

// 旧フロー（ParticipantRoom）と新しい流れ（GuidedGuest）の両方で使う参加者の手順

/** 旧フローでは画面の中央に置き、新しい流れでは親の列にそのまま並べる */
/** 学生の画面で、話し合うテーマを大きく出す（意見・議論・結論の画面の上） */
export function ThemeCard({ theme, heading }: { theme: string; heading?: string }) {
  return (
    <section className="theme-card" aria-label={heading ? undefined : `テーマ：${theme}`} aria-labelledby={heading ? "theme-card-heading" : undefined}>
      {heading ? <h2 id="theme-card-heading" className="theme-card__label">{heading}</h2> : <p className="theme-card__label">テーマ</p>}
      <p className="theme-card__text">{heading && <span className="sr-only">テーマ：</span>}{theme}</p>
    </section>
  );
}

function Wrap({ bare, children }: { bare: boolean; children: React.ReactNode }) {
  return bare ? <>{children}</> : <div className="body body--center">{children}</div>;
}
/** P2 目標と意見の入力。意見は本人だけが読める（司会者も読めない）。目標はこの端末にだけ残す。
 * 出したあとは、グループ全員がそろうまで待つ（そろうと自動で議論の画面に変わる） */
export function OpinionStep({ roomId, uid, total, opinions, canChange, onChangeGroup, bare = false }: {
  roomId: string; uid: string; total?: number; opinions?: number; canChange: boolean; onChangeGroup: () => void;
  /** 1本化した流れでは、目標の欄を出さず、画面のカードとして出す */
  bare?: boolean;
}) {
  const mine = useDoc<{ text: string }>(`sessions/${roomId}/privateOpinions/${uid}`).data;
  const [goal, setGoal] = useState("");
  const [opinion, setOpinion] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [prev, setPrev] = useState<string>();
  const loaded = useRef(false);

  useEffect(() => { setPrev(getNextGoal()?.text); setGoal(getReflection(roomId).goal ?? ""); }, [roomId]);
  useEffect(() => {
    if (mine && !loaded.current) { loaded.current = true; setOpinion(mine.text); setSent(true); }
  }, [mine]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      saveReflection(roomId, { goal: goal.trim() || undefined });
      // API 経由で出す。グループ全員がそろうと、API がそのグループの議論を始める
      await callApi(`/rooms/${roomId}/opinion`, { text: opinion.trim() });
      setSent(true);
    } catch (err) { setError(`提出できませんでした：${(err as Error).message}`); }
  }

  return (
    <Wrap bare={bare}>
      <form className={bare ? "flow-card" : "box box--lg card"} onSubmit={submit}>
        <div className="heading-row">
          <h2 className="card__title">議論の前に書く</h2>
          {canChange && !mine && <button type="button" className="btn btn--small" onClick={onChangeGroup}>グループを選び直す</button>}
        </div>
        {!bare && prev && (
          <div className="box box--yellow" style={{ padding: "10px 14px" }}>
            <p className="t-small" style={{ fontWeight: 700 }}>前回決めたこと</p>
            <p className="t-sm">{prev}</p>
          </div>
        )}
        {!bare && <div className="field">
          <label className="field__label" htmlFor="goal">今日の目標</label>
          <input id="goal" className="input" value={goal} maxLength={60} placeholder="例：根拠をつけて意見を話す" onChange={(e) => setGoal(e.target.value)} />
        </div>}
        <div className="field">
          <label className="field__label" htmlFor="opinion">あなたの意見（本人だけが見られます）</label>
          <textarea id="opinion" className="input" value={opinion} maxLength={1000} rows={3} placeholder="例：飲食のバイトで、人と話す力がつくと思う"
            onChange={(e) => { setOpinion(e.target.value); setSent(false); }} />
          <p className="field__hint">教員にもほかの参加者にも本文は見えません。AI が、まだ話されていない論点を見つけるためだけに使います。</p>
        </div>
        {error && <p className="notice notice--error" role="alert">{error}</p>}
        <button className="btn btn--blue btn--block" type="submit" disabled={!opinion.trim()}>{mine ? "書き直して提出する" : "提出する"}</button>
        {sent && <p className="notice" role="status">提出しました</p>}
        {mine && (
          <div className="notice notice--warn stack stack--tight">
            <p className="t-label">{bare ? "教員が議論を始めるまで待っています" : `グループのみんなの意見を待っています${total ? `（${opinions ?? 0}/${total}人）` : ""}`}</p>
            <p className="t-note">議論が始まると、この画面が変わります。それまでは書き直せます。</p>
          </div>
        )}
      </form>
    </Wrap>
  );
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
    <section className={bare ? "flow-card memo" : "box box--md pad stack memo"} aria-label="議論の発言メモ">
      <div className="heading-row"><h2 className="t-sm">発言メモ</h2><Tag>グループと教員に表示</Tag></div>
      {messages.length === 0
        ? <p className="t-note">話し合いで出た意見を、短く書いて共有します。</p>
        : <ul className="feed memo__feed">{messages.slice(-8).map((m) => <li key={m.id} className="bubble">{m.text}</li>)}</ul>}
      <form className="memo__composer" onSubmit={send}>
        <label className="sr-only" htmlFor="note">発言を書く</label>
        <input id="note" className="input" maxLength={500} placeholder="例：貸出があれば公平になる" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn btn--blue" disabled={busy || !text.trim()}>{busy ? "共有しています…" : "メモを共有する"}</button>
      </form>
      <p className="t-small">AI は、このメモと全員の事前の意見を照らし合わせて、まだ話されていない論点を探します。</p>
      {error && <p className="notice notice--error" role="alert">{error}</p>}
    </section>
  );
}

const AGREEMENT = ["まったく納得していない", "あまり納得していない", "どちらともいえない", "おおむね納得", "とても納得"];

/** P4 結論の理解を入力。本人だけが読み書きできる */
export function ConsensusStep({ roomId, uid, submitted, total, bare = false }: { roomId: string; uid: string; title: string; submitted?: number; total?: number; bare?: boolean }) {
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
        <div className="field">
          <label className="field__label" htmlFor="stmt">グループの結論を、あなたはどう理解した？</label>
          <textarea id="stmt" className="input" rows={2} maxLength={300} value={text} placeholder="例：将来の仕事に役立つ経験を増やすこと" onChange={(e) => setText(e.target.value)} />
          <p className="field__hint">正解はありません。あなたの言葉で一文で書いてください。</p>
        </div>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field__label" style={{ marginBottom: 6 }}>その結論に、どのくらい納得している？</legend>
          {/* 5段階の目盛り。見た目は数字、ボタンの名前は「4 おおむね納得」のように数字と言葉（見える文字を名前に含める） */}
          <div className="scale">
            <div className="scale__options">
              {AGREEMENT.map((label, i) => (
                <button key={label} type="button" className="scale__option" title={label} aria-pressed={agreement === i + 1} onClick={() => setAgreement(i + 1)}>{i + 1}<span className="sr-only"> {label}</span></button>
              ))}
            </div>
            <div className="scale__ends" aria-hidden="true"><span>納得していない</span><span>とても納得</span></div>
            <p className="scale__value" aria-hidden="true">{agreement ? AGREEMENT[agreement - 1] : "数字を1つ選んでください"}</p>
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

const ACHIEVED = ["できた", "少しできた", "まだ"];
const SPOKE = ["言えた", "一部言えた", "言えなかった", "特になかった"];

/** P4-2 認識のちがい ＋ P5 振り返り。グループの結果は全員に、振り返りはこの端末にだけ残す */
export function ResultStep({ roomId, uid, group, source, title, result, showSpeaking = false }: { roomId: string; uid: string; group: number; source?: string; title: string; result: GroupResult | null; showSpeaking?: boolean }) {
  const mine = useDoc<{ text: string; agreement?: number }>(`sessions/${roomId}/consensusStatements/${uid}`).data;
  const opinion = useDoc<{ text: string }>(`sessions/${roomId}/privateOpinions/${uid}`).data;
  const groups = [...(result?.clusters ?? [])].sort((a, b) => b.count - a.count).map((c) => ({ label: c.label, count: c.count }));
  const alignment = result?.alignmentRate ?? null;
  const { flow } = useFlow(roomId, group, source);
  // 見直す点の問い（録音の分析にあるとき）を、振り返りの最初の問いにする
  const question = flow && flow.speechDetected !== false ? flow.review.find((r) => r.question)?.question : undefined;

  return (
    <div className="result-s" aria-label={`${title}の結果`}>
      <h2 className="result-s__region">議論の分析</h2>

      <h3 className="result-s__h">結論の理解</h3>
      <div className="result-s__understand">
        <AgreementCard mine={mine?.agreement} summary={result?.agreement ?? null} />
        <div className="result-s__col">
          <section className="panel result-s__card" aria-labelledby="change-title">
            <div className="heading-row"><h4 id="change-title" className="result-s__card-title">あなたの考えの変化</h4><span className="tag tag--blue">あなただけに表示</span></div>
            <div className="result-s__change">
              <div className="result-s__before"><p className="result-s__label">議論の前（事前の意見）</p><p>{opinion?.text ?? "（書いていません）"}</p></div>
              <p className="result-s__arrow" aria-hidden="true">↓</p>
              <div className="result-s__after"><p className="result-s__label">議論の後（あなたの結論）</p><p className="result-s__after-text">{mine?.text ?? "（書いていません）"}</p></div>
            </div>
          </section>
          {!result ? (
            <p className="notice">グループ全員が結論の一文を書くと、ここに理解の分かれ方が出ます。</p>
          ) : (
            <section className="result-s__split" aria-labelledby="split-title">
              <div className="heading-row"><h4 id="split-title" className="result-s__card-title">グループの理解の分かれ方</h4><SourceTag source={result.source} /></div>
              <p className="result-s__split-lead">{describeUnderstanding(groups)}</p>
              <ul className="result-s__split-list">{groups.map((g, i) => <li key={i}>{g.label}（{g.count}人）</li>)}</ul>
              <p className="result-s__split-note">同じ理解だった人：{formatMetric(alignment, result.source === "mock" ? "mock" : "gemini")}。誰がどれを書いたかは表示しません。</p>
            </section>
          )}
        </div>
      </div>

      {/* 録音の分析も、教員が許可した発言の集計もないときは、空の欄を出さない */}
      {(flow || showSpeaking) && <>
        <h3 className="result-s__h">グループの議論</h3>
        {showSpeaking ? <FlowSpeaking roomId={roomId} group={group} flow={flow} /> : <FlowTimeline flow={flow} compact />}
      </>}

      {flow && flow.speechDetected !== false && <>
        <h3 className="result-s__h">よかった点と見直す点</h3>
        <GoodReview flow={flow} />
      </>}

      <ReflectionCard roomId={roomId} question={question} />
      <Link className="btn" href="/home" style={{ alignSelf: "flex-start" }}>ホームに戻る</Link>
    </div>
  );
}

/**
 * 納得度（Figma 335:44）。1〜5の棒で、グループの人数の分布を出し、本人の値を濃い青にする。
 * 回答が4人未満のとき、サーバーは分布と平均を送らない（自分の値から、ほかの人の値が分かるため）。そのときは本人の値だけを出す。
 */
function AgreementCard({ mine, summary }: { mine?: number; summary: GroupResult["agreement"] | null }) {
  const counts = summary?.counts ?? null;
  const max = counts ? Math.max(1, ...counts) : 1;
  const head = [mine ? `あなた ${mine}` : "", counts && summary?.average != null ? `平均 ${summary.average.toFixed(1)}` : ""].filter(Boolean).join("・");
  return (
    <section className="panel result-s__agree" aria-labelledby="agree-title">
      <div>
        <h4 id="agree-title" className="result-s__card-title">納得度</h4>
        <p className="t-note">{head || "まだ回答がありません"}</p>
      </div>
      <div className="agree-bars" role="img" aria-label={counts ? `納得度の分布。${counts.map((c, i) => `${i + 1}は${c}人`).join("、")}。${mine ? `あなたは${mine}` : ""}` : mine ? `あなたの納得度は${mine}` : "納得度の回答なし"}>
        {[1, 2, 3, 4, 5].map((n, i) => {
          const c = counts ? counts[i] : n === mine ? 1 : 0;
          const own = n === mine;
          return (
            <div key={n} className="agree-bars__col" data-own={own || undefined}>
              <span className="agree-bars__bar" data-empty={!c || undefined} style={{ height: c ? `${(c / max) * 100}%` : undefined }} />
              <span className="agree-bars__n">{n}</span>
            </div>
          );
        })}
      </div>
      <div className="agree-bars__ends" aria-hidden="true"><span>納得していない</span><span>とても納得</span></div>
      {!counts && mine && <p className="t-note">回答が4人未満のため、グループの分布と平均は表示しません。</p>}
    </section>
  );
}

/** あなたの振り返り（Figma 182:1638）。入力はこの端末だけに残し、次の議論の前に「前回の目標」として出す */
function ReflectionCard({ roomId, question }: { roomId: string; question?: string }) {
  const [r, setR] = useState(() => getReflection(roomId));
  const [saved, setSaved] = useState(false);
  const set = (patch: Partial<typeof r>) => { setR({ ...r, ...patch }); setSaved(false); };
  const ready = !!r.ifAgain?.trim() && !!r.nextGoal?.trim();
  return (
    <section className="result-s__reflect" aria-labelledby="reflect-title">
      <div>
        <h3 id="reflect-title" className="result-s__reflect-title">あなたの振り返り</h3>
        <p className="t-note">入力内容はあなただけが見られます。</p>
      </div>
      <div className="result-s__reflect-grid">
        <div className="result-s__reflect-box">
          {r.goal && <>
            <p className="result-s__label">今日の目標</p>
            <p className="result-s__goal">{r.goal}</p>
            <p className="result-s__q">目標の達成度</p>
            <div className="choices choices--three">
              {ACHIEVED.map((x) => <button key={x} type="button" className="choice" aria-pressed={r.achieved === x} onClick={() => set({ achieved: x })}>{x}</button>)}
            </div>
          </>}
          <p className="result-s__q">意見を伝えられたか</p>
          <div className="choices choices--two">
            {SPOKE.map((x) => <button key={x} type="button" className="choice" aria-pressed={r.spoke === x} onClick={() => set({ spoke: x })}>{x}</button>)}
          </div>
        </div>
        <div className="result-s__reflect-box">
          <h4 className="result-s__reflect-sub">振り返り</h4>
          <div className="field">
            {question
              ? <label className="result-s__question" htmlFor="again">問い：{question}</label>
              : <label className="field__label" htmlFor="again">もう一度話すなら、どうする？</label>}
            <textarea id="again" className="input" rows={2} value={r.ifAgain ?? ""} maxLength={120} placeholder="例：アルバイトで学んだことを、事前の意見として話す" onChange={(e) => set({ ifAgain: e.target.value })} />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="next">次の議論で実践する目標</label>
            <input id="next" className="input" value={r.nextGoal ?? ""} maxLength={60} placeholder="例：自分の意見の前に、1つ質問する" onChange={(e) => set({ nextGoal: e.target.value })} />
          </div>
        </div>
      </div>
      {/* 自分の言葉で2つとも書いてから保存する（空のままの振り返りを残さない） */}
      <button type="button" className="btn btn--blue btn--block" disabled={!ready}
        onClick={() => { saveReflection(roomId, { ...r, ifAgain: r.ifAgain?.trim(), nextGoal: r.nextGoal?.trim(), savedAt: Date.now() }); setSaved(true); }}>振り返りを保存</button>
      {saved ? <p role="status">保存済み。次回の議論前に表示します。</p> : !ready && <p className="t-note">2つとも書くと保存できます。</p>}
    </section>
  );
}
