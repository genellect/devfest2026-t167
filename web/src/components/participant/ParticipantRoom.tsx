"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { addDoc, collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { Header, PhaseSteps, SourceTag, Tag, useGeminiSource } from "@/components/ui";
import { firebase } from "@/lib/firebase";
import { formatMetric } from "@/lib/format";
import { getNextGoal, getReflection, saveReflection } from "@/lib/local";
import { useDoc, useInsights, useMessages, type Room, type Summary } from "@/lib/room";

interface Props { roomId: string; room: Room; uid: string }

/** 生徒（タブレット横向き）の画面。部屋のフェーズで切り替える */
export function ParticipantRoom({ roomId, room, uid }: Props) {
  const source = useGeminiSource();
  const summary = useDoc<Summary>(room.phase === "consensus" || room.phase === "closed" ? `rooms/${roomId}/results/summary` : undefined).data;
  return (
    <main className="screen">
      <Header title={room.title} demo={source === "mock"}>
        <PhaseSteps phase={room.phase} />
      </Header>
      {room.phase === "collecting" && <OpinionStep roomId={roomId} uid={uid} />}
      {room.phase === "discussing" && <DiscussionStep roomId={roomId} uid={uid} />}
      {room.phase === "consensus" && !summary && <ConsensusStep roomId={roomId} uid={uid} title={room.title} />}
      {(room.phase === "closed" || summary) && <ResultStep roomId={roomId} uid={uid} title={room.title} summary={summary ?? null} closed={room.phase === "closed"} />}
    </main>
  );
}

/** P2 目標と意見の入力。意見は本人だけが読める（司会者も読めない）。目標はこの端末にだけ残す */
function OpinionStep({ roomId, uid }: { roomId: string; uid: string }) {
  const mine = useDoc<{ text: string }>(`rooms/${roomId}/privateOpinions/${uid}`).data;
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
      await setDoc(doc(firebase().db, `rooms/${roomId}/privateOpinions/${uid}`), { text: opinion.trim(), updatedAt: serverTimestamp() });
      setSent(true);
    } catch (err) { setError(`提出できませんでした：${(err as Error).message}`); }
  }

  return (
    <div className="body body--center">
      <form className="box box--lg card" onSubmit={submit}>
        <h2 className="card__title">議論の前に書く</h2>
        {prev && (
          <div className="box box--yellow" style={{ padding: "10px 14px" }}>
            <p className="t-small" style={{ fontWeight: 700 }}>前回決めたこと</p>
            <p className="t-sm">{prev}</p>
          </div>
        )}
        <div className="field">
          <label className="field__label" htmlFor="goal">今日の目標</label>
          <input id="goal" className="input" value={goal} maxLength={60} placeholder="例：根拠をつけて意見を話す" onChange={(e) => setGoal(e.target.value)} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="opinion">あなたの意見（本人だけが見られます）</label>
          <textarea id="opinion" className="input" value={opinion} maxLength={1000} rows={3} placeholder="例：飲食のバイトで、人と話す力がつくと思う"
            onChange={(e) => { setOpinion(e.target.value); setSent(false); }} />
          <p className="field__hint">先生にもほかの人にも本文は見えません。AI が、まだ話されていない論点を見つけるためだけに使います。</p>
        </div>
        {error && <p className="notice notice--error" role="alert">{error}</p>}
        <button className="btn btn--blue btn--block" type="submit" disabled={!opinion.trim()}>{mine ? "書き直して提出する" : "提出する"}</button>
        {sent && <p className="notice" role="status">提出しました</p>}
      </form>
    </div>
  );
}

/** P3 議論。発言は全員の画面に出る。先生が承認した AI の問いだけが届く */
function DiscussionStep({ roomId, uid }: { roomId: string; uid: string }) {
  const messages = useMessages(roomId, true);
  const insights = useInsights(roomId, true, true);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const feedEnd = useRef<HTMLDivElement>(null);
  useEffect(() => { feedEnd.current?.scrollIntoView({ block: "end" }); }, [messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText(""); setError("");
    try {
      await addDoc(collection(firebase().db, `rooms/${roomId}/messages`), { uid, text: t, createdAt: serverTimestamp() });
    } catch (err) { setText(t); setError(`送れませんでした：${(err as Error).message}`); }
  }

  return (
    <div className="body body--tablet" style={{ flexDirection: "row", alignItems: "stretch", minHeight: 0 }}>
      <section className="box box--md stack" style={{ flex: 1, padding: 22, minHeight: 0 }}>
        <h2 className="t-md">グループで話し合いましょう</h2>
        <div className="feed" style={{ flex: 1, minHeight: 240, maxHeight: "calc(100dvh - 330px)" }} aria-live="polite">
          {messages.length === 0 && <p className="empty">最初のひとことを書いてみましょう。</p>}
          {messages.map((m) => (
            <div key={m.id} className={`bubble${m.uid === uid ? " bubble--mine" : ""}`}>
              <p className="bubble__who">{m.uid === uid ? "あなた" : "メンバー"}</p>
              <p>{m.text}</p>
            </div>
          ))}
          <div ref={feedEnd} />
        </div>
        <form onSubmit={send} style={{ display: "flex", gap: 12 }}>
          <label className="sr-only" htmlFor="say">発言</label>
          <input id="say" className="input" value={text} maxLength={500} placeholder="意見や質問を書く" onChange={(e) => setText(e.target.value)} />
          <button className="btn btn--blue" type="submit" disabled={!text.trim()}>送る</button>
        </form>
        {error && <p className="notice notice--error" role="alert">{error}</p>}
      </section>
      <aside className="stack" style={{ width: 360, flex: "0 0 auto" }}>
        <section className="box box--md box--yellow pad stack">
          <div className="heading-row"><h2 className="t-sm">先生からの問いかけ</h2><Tag>AI の提案</Tag></div>
          {insights.length === 0
            ? <p className="t-note">まだ話されていない論点が見つかると、先生がここに出します。</p>
            : insights.map((i) => <p key={i.id} className="t-sm" style={{ borderTop: "3px solid #000", paddingTop: 8 }}>{i.summary}</p>)}
        </section>
        <section className="box box--sm pad stack stack--tight">
          <p className="t-label">議論が終わったら</p>
          <p className="t-note">先生が合意の確認に進めると、結論を自分の言葉で書く画面に変わります。</p>
        </section>
      </aside>
    </div>
  );
}

const AGREEMENT = ["まったく納得していない", "あまり納得していない", "どちらともいえない", "おおむね納得", "とても納得"];

/** P4 結論の理解を入力。本人だけが読み書きできる */
function ConsensusStep({ roomId, uid, title }: { roomId: string; uid: string; title: string }) {
  const mine = useDoc<{ text: string; agreement: number; concern?: string }>(`rooms/${roomId}/consensusStatements/${uid}`).data;
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
      await setDoc(doc(firebase().db, `rooms/${roomId}/consensusStatements/${uid}`), {
        text: text.trim(), agreement, ...(concern.trim() ? { concern: concern.trim() } : {}), updatedAt: serverTimestamp(),
      });
    } catch (err) { setError(`提出できませんでした：${(err as Error).message}`); }
  }

  return (
    <div className="body body--center">
      <form className="box box--lg card" onSubmit={submit}>
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
          <div className="choices">
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
        {mine && <p className="notice" role="status">提出しました。全員がそろったら、先生が結果を分析します。</p>}
      </form>
    </div>
  );
}

const ACHIEVED = ["できた", "少しできた", "まだ"];
const SPOKE = ["言えた", "一部言えた", "言えなかった", "特になかった"];

/** P4-2 認識のちがい ＋ P5 振り返り。グループの結果は全員に、振り返りはこの端末にだけ残す */
function ResultStep({ roomId, uid, title, summary, closed }: { roomId: string; uid: string; title: string; summary: Summary | null; closed: boolean }) {
  const mine = useDoc<{ text: string }>(`rooms/${roomId}/consensusStatements/${uid}`).data;
  const opinion = useDoc<{ text: string }>(`rooms/${roomId}/privateOpinions/${uid}`).data;
  const [r, setR] = useState(() => getReflection(roomId));
  const [saved, setSaved] = useState(false);
  const set = (patch: Partial<typeof r>) => { setR({ ...r, ...patch }); setSaved(false); };
  const groups = [...(summary?.groups ?? [])].sort((a, b) => b.members.length - a.members.length);

  return (
    <div className="body body--tablet">
      <section className="box box--md box--blue pad">
        <p className="t-label">議論のテーマ</p>
        <p className="t-lg">{title}</p>
      </section>

      <h2 className="t-md">同じ結論を、どう理解した？</h2>
      {!summary ? (
        <p className="box box--sm pad t-label">先生が結果を分析すると、ここにみんなの理解の分かれ方が出ます。</p>
      ) : (
        <div className="row">
          <section className="box box--sm box--yellow pad stack">
            <div className="heading-row"><h3 className="t-sm">あなたの理解</h3><Tag tone="tint">あなたの入力</Tag></div>
            <p className="t-md">{mine?.text ?? "（入力していません）"}</p>
          </section>
          <section className="box box--sm pad stack">
            <div className="heading-row"><h3 className="t-sm">みんなの理解の分かれ方</h3><SourceTag source={summary.source} /></div>
            <p className="t-md">{groups.length <= 1 ? "理解はほぼそろっていました。" : `${groups.length}通りに分かれました。`}</p>
            <ul className="stack stack--tight" style={{ margin: 0, paddingLeft: 20 }}>
              {groups.map((g, i) => <li key={i} className="t-label">{g.label}（{g.members.length}人）</li>)}
            </ul>
            <p className="t-note">認識一致度：{formatMetric(summary.metrics.alignmentRate, summary.source === "mock" ? "mock" : "gemini")}</p>
          </section>
        </div>
      )}

      {closed && (
        <>
          <h2 className="t-md">自分はどう関わっていたか</h2>
          <div className="row">
            <section className="box box--sm pad stack">
              <p className="t-small" style={{ fontWeight: 700 }}>今日の目標</p>
              <p className="t-md">{r.goal ?? "（目標は書いていません）"}</p>
              {opinion && (
                <div className="box box--tint" style={{ padding: "8px 12px" }}>
                  <p className="t-small" style={{ fontWeight: 700 }}>事前の意見</p>
                  <p>{opinion.text}</p>
                </div>
              )}
              <p className="t-label">目標は達成できた？</p>
              <div className="choices">
                {ACHIEVED.map((x) => <button key={x} type="button" className="choice" aria-pressed={r.achieved === x} onClick={() => set({ achieved: x })}>{x}</button>)}
              </div>
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
              <div className="field">
                <label className="field__label" htmlFor="next">次の議論で実践する目標</label>
                <input id="next" className="input" style={{ color: "#000" }} value={r.nextGoal ?? ""} maxLength={60} placeholder="例：自分の意見の前に、1つ質問する" onChange={(e) => set({ nextGoal: e.target.value })} />
              </div>
              <button type="button" className="btn btn--yellow" style={{ alignSelf: "flex-end" }}
                onClick={() => { saveReflection(roomId, { ...r, savedAt: Date.now() }); setSaved(true); }}>振り返りを保存</button>
              {saved && <p role="status">保存しました。次の議論の前に表示します。</p>}
            </section>
          </div>
          <Link className="btn" href="/" style={{ alignSelf: "flex-start" }}>ホームに戻る</Link>
        </>
      )}
    </div>
  );
}
