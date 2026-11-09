"use client";
import { useEffect, useState } from "react";

/**
 * LP の「デモを体験」。ログインなしで、1つの議論を「書く → 話す → まとめる」の順に体験する。
 * 学生として書き、教員の画面で何が見えるかを並べて見せる。入力はこの端末の中だけで使い、送信しない。
 * 例はチームドキュメント「アプリの構想」の合意の実態検証（A〜D の4通りの理解）による。
 */

const THEME = "課題での AI の利用を認めるか";
const SAMPLE = "認めてよい。ただし、使ったことは書くべき。";
const CLASSMATES = 5;
const TALK = [
  { who: "A", text: "レポートを丸ごと書かせるのは、ちがうと思う。" },
  { who: "B", text: "でも、調べものには便利だよね。" },
  { who: "C", text: "社会に出たら使うんだし、慣れたほうがいい。" },
  { who: "D", text: "じゃあ、認めるってことで。" },
];
const READINGS = [
  { text: "申告すれば、レポートにも使える", color: "blue", base: 2 },
  { text: "アイデア出しにだけ使える", color: "pink", base: 2 },
  { text: "教員が許可したときだけ", color: "mint", base: 1 },
] as const;
const STEPS = ["書く", "話す", "まとめる"] as const;

function reduced() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function LpDemo() {
  const [step, setStep] = useState(0);
  const [text, setText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [others, setOthers] = useState(0);
  const [lines, setLines] = useState(0);
  const [question, setQuestion] = useState<"pending" | "shown" | "skipped">("pending");
  const [choice, setChoice] = useState<number | null>(null);

  // ほかの学生の提出（書く）と、話し合いの発言（話す）は、時間をおいて順に届く
  useEffect(() => {
    if (step !== 0 || others >= CLASSMATES) return;
    const t = setTimeout(() => setOthers((n) => n + 1), reduced() ? 0 : 700);
    return () => clearTimeout(t);
  }, [step, others]);
  useEffect(() => {
    if (step !== 1 || lines >= TALK.length) return;
    const t = setTimeout(() => setLines((n) => n + 1), reduced() ? 0 : lines === 0 ? 300 : 1100);
    return () => clearTimeout(t);
  }, [step, lines]);

  function restart() {
    setStep(0); setText(""); setSubmitted(false); setOthers(0); setLines(0); setQuestion("pending"); setChoice(null);
  }

  const talked = lines >= TALK.length;
  const total = others + (submitted ? 1 : 0);

  return (
    <div className="demo">
      <ol className="demo__steps" aria-label="デモの進み具合">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? "is-now" : i < step ? "is-done" : undefined} aria-current={i === step ? "step" : undefined}>
            <span className="demo__n">{i + 1}</span>{s}
          </li>
        ))}
      </ol>

      <p className="demo__theme"><span>テーマ</span>{THEME}</p>

      <div className="demo__stage">
        {/* 学生の画面 */}
        <section className="demo__pane demo__pane--student" aria-label="学生の画面">
          <p className="demo__who">学生の画面</p>

          {step === 0 && !submitted && (
            <form className="demo__write" onSubmit={(e) => { e.preventDefault(); if (text.trim()) setSubmitted(true); }}>
              <label htmlFor="demo-opinion" className="demo__label">議論の前に、あなたの考えを書いてみよう</label>
              <textarea id="demo-opinion" className="demo__input" rows={3} maxLength={60} value={text} onChange={(e) => setText(e.target.value)} placeholder="たとえば：認めていい。でも、使ったことは書くべき" />
              <p className="demo__hint">書いた本文は、あなたにしか見えない。</p>
              <div className="demo__row">
                <button type="submit" className="lp-btn lp-btn--primary" disabled={!text.trim()}>書き終えた</button>
                <button type="button" className="lp-btn lp-btn--text" onClick={() => setText(SAMPLE)}>例を入れてみる</button>
              </div>
            </form>
          )}
          {step === 0 && submitted && (
            <div className="demo__done" role="status">
              <p className="paper paper--mine">{text}</p>
              <p className="demo__hint">書けた。この考えは、あなたにしか見えない。</p>
            </div>
          )}

          {step === 1 && (
            <div className="demo__talk">
              {question === "shown" && <p className="demo__ask" role="status"><span>教員から</span>AI を使ったことを、どこまで申告する？</p>}
              <ul className="demo__lines" aria-live="polite">
                {TALK.slice(0, lines).map((l) => <li key={l.who}><span className="demo__avatar">{l.who}</span><p>{l.text}</p></li>)}
              </ul>
              {!talked && <p className="demo__hint">議論が進んでいる…</p>}
            </div>
          )}

          {step === 2 && (
            <div className="demo__sum">
              <p className="demo__label" id="demo-reading">結論を、自分の言葉で言うなら？</p>
              <div className="demo__choices" role="radiogroup" aria-labelledby="demo-reading">
                {READINGS.map((r, i) => (
                  <button key={r.text} type="button" role="radio" aria-checked={choice === i} className={`demo__choice${choice === i ? " is-on" : ""}`} onClick={() => setChoice(i)} disabled={choice !== null && choice !== i}>{r.text}</button>
                ))}
              </div>
              {choice !== null && <p className="demo__hint" role="status">ほかの5人も、それぞれの言葉で書いた。</p>}
            </div>
          )}
        </section>

        {/* 教員の画面 */}
        <section className="demo__pane demo__pane--teacher" aria-label="教員の画面">
          <p className="demo__who">教員の画面</p>

          {step === 0 && (
            <div>
              <p className="demo__label">集まった考え　{total} / {CLASSMATES + 1}人</p>
              <ul className="demo__slots" aria-hidden="true">
                {Array.from({ length: CLASSMATES + 1 }, (_, i) => <li key={i} className={i < total ? "is-in" : undefined} />)}
              </ul>
              <p className="demo__hint">教員に見えるのは、集まった人数だけ。中身は見えない。</p>
            </div>
          )}

          {step === 1 && (
            <div className="demo__teacher-talk">
              {!talked && <p className="demo__hint">議論と、事前に書かれた考えを照らし合わせている…</p>}
              {talked && question === "pending" && (
                <div className="ai-note" role="status">
                  <p className="ai-note__label">まだ話されていない論点</p>
                  <p className="ai-note__text">AI を使ったことを、どこまで申告する？</p>
                  <p className="ai-note__why">事前に2人が書いていたのに、まだ誰も話していない。</p>
                  <div className="demo__row">
                    <button type="button" className="lp-btn lp-btn--dark" onClick={() => setQuestion("shown")}>全員に問いかける</button>
                    <button type="button" className="lp-btn lp-btn--text" onClick={() => setQuestion("skipped")}>今は見送る</button>
                  </div>
                </div>
              )}
              {question === "shown" && <div className="board"><p className="board__label">教室に映す画面</p><p className="board__text">AI を使ったことを、どこまで申告する？</p></div>}
              {question === "skipped" && <p className="demo__hint" role="status">見送った。学生に届けるかどうかは、いつも教員が決める。</p>}
            </div>
          )}

          {step === 2 && (
            <div className="demo__result">
              <p className="demo__label">グループの結論</p>
              <p className="demo__conclusion">AI の利用を認める。<span>全員が賛成</span></p>
              {choice === null
                ? <p className="demo__hint">全員の一文を待っている…</p>
                : (
                  <div role="status">
                    <ul className="demo__split">
                      {READINGS.map((r, i) => <li key={r.text} className={`paper paper--${r.color}`}><span>{r.text}</span><small>{r.base + (choice === i ? 1 : 0)}人{choice === i ? "（あなたを含む）" : ""}</small></li>)}
                    </ul>
                    <p className="demo__punch">全員が賛成。<br />でも、同じことには賛成していなかった。</p>
                  </div>
                )}
            </div>
          )}
        </section>
      </div>

      <div className="demo__next">
        {step === 0 && <button type="button" className="lp-btn lp-btn--primary" disabled={!submitted || others < CLASSMATES} onClick={() => setStep(1)}>議論を始める</button>}
        {step === 1 && <button type="button" className="lp-btn lp-btn--primary" disabled={!talked || question === "pending"} onClick={() => setStep(2)}>結論をまとめる</button>}
        {step === 2 && choice !== null && <button type="button" className="lp-btn lp-btn--text" onClick={restart}>もう一度やってみる</button>}
        <p className="demo__note">このデモは端末の中だけで動く。入力した文章は送信しない。</p>
      </div>
    </div>
  );
}
