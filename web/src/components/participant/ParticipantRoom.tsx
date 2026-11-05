"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { FlowTimeline, GoodReview, useFlow } from "@/components/flow";
import { Header, PhaseSteps, SourceTag, Tag, useGeminiSource } from "@/components/ui";
import { callApi } from "@/lib/api";
import { firebase } from "@/lib/firebase";
import { formatMetric } from "@/lib/format";
import { getNextGoal, getReflection, saveReflection } from "@/lib/local";
import { mmss, useRecorder } from "@/lib/recorder";
import { useDoc, useInsights, type GroupResult, type Room } from "@/lib/room";

interface Props { roomId: string; room: Room; uid: string; group: number }

/** 生徒（タブレット横向き）の画面。部屋のフェーズで切り替える */
export function ParticipantRoom({ roomId, room, uid, group }: Props) {
  const source = useGeminiSource();
  const gs = room.groupState?.[String(group)];
  // グループの結果。全員の一文がそろうと API が書く
  const result = useDoc<GroupResult>(room.phase !== "collecting" ? `rooms/${roomId}/results/group-${group}` : undefined).data;
  const writing = !result && room.phase !== "closed" && (room.phase === "consensus" || gs?.status === "consensus" || gs?.status === "done");
  return (
    <main className="screen">
      <Header eyebrow={(room.groups ?? 1) > 1 ? `あなたはグループ${group}` : undefined} title={room.title} demo={source === "mock"}>
        <PhaseSteps phase={room.phase} />
        <Link className="btn btn--small" href="/student">ホーム</Link>
      </Header>
      {room.phase === "collecting" && <OpinionStep roomId={roomId} uid={uid} />}
      {room.phase === "discussing" && !gs?.status && !result && <VoiceStep roomId={roomId} />}
      {writing && <ConsensusStep roomId={roomId} uid={uid} title={room.title} submitted={gs?.submitted} total={gs?.total} />}
      {(result || room.phase === "closed") && <ResultStep roomId={roomId} uid={uid} group={group} source={source} title={room.title} result={result ?? null} />}
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

/**
 * P3 議論（音声）。グループで1台、または1人1台で録音する。画面を見なくても話し合えるようにする。
 * 録音は端末の中に置くだけで、まだ送信しない（送信と文字起こしはバックエンドで実装予定）。
 * 先生が承認した AI の問いかけだけが届く。
 */
function VoiceStep({ roomId }: { roomId: string }) {
  const insights = useInsights(roomId, true, true);
  const rec = useRecorder();
  const [confirming, setConfirming] = useState(false);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState("");
  async function endDiscussion() {
    setEnding(true); setError("");
    try {
      await rec.stop(); // 録音は端末に残す（送信はバックエンドの実装後）
      await callApi(`/rooms/${roomId}/groups/end`);
    } catch (e) { setError((e as Error).message); setEnding(false); }
  }
  const scale = 1 + rec.level * 0.45;
  const status = {
    idle: "録音を始めると、議論が終わるまで自動で記録します。",
    asking: "マイクの使用を許可してください。",
    recording: "録音中・議論を続けてください",
    paused: "一時停止中",
    stopped: "録音を終えました",
    denied: "マイクが使えません。ブラウザの設定でマイクを許可してから、もう一度試してください。",
    unsupported: "この端末やブラウザでは録音できません。別の端末で録音するか、そのまま話し合ってください。",
  }[rec.state];

  return (
    <div className="body body--tablet" style={{ flexDirection: "row", alignItems: "stretch" }}>
      <section className="box box--lg pad-lg stack" style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 24, textAlign: "center" }}>
        <h2 className="t-lg">グループで話し合いましょう</h2>
        <p className="t-label">議論が終わるまで、画面を見なくても大丈夫です。</p>
        <div className="voice" data-state={rec.state} aria-hidden="true">
          <div className="voice__ring" style={{ transform: `scale(${rec.state === "recording" ? scale : 0.82})` }} />
          <div className="voice__core">{rec.state === "recording" || rec.state === "paused" ? mmss(rec.elapsedMs) : "マイク"}</div>
        </div>
        <div className={`notice${rec.state === "denied" || rec.state === "unsupported" ? " notice--error" : rec.state === "recording" ? "" : " notice--warn"}`}
          role="status" style={{ display: "flex", alignItems: "center", gap: 16, width: "min(560px, 100%)", justifyContent: "space-between", textAlign: "left" }}>
          <span className="t-label">{status}</span>
          {(rec.state === "idle" || rec.state === "denied") && <button className="btn btn--blue btn--small" onClick={rec.start}>{rec.state === "denied" ? "もう一度試す" : "録音を始める"}</button>}
          {rec.state === "recording" && <button className="btn btn--small" onClick={rec.pause}>一時停止</button>}
          {rec.state === "paused" && <button className="btn btn--blue btn--small" onClick={rec.resume}>再開する</button>}
        </div>
        <p className="t-small">録音はこの端末の中にだけ残ります（送信と文字起こしは準備中です）。</p>
      </section>
      <aside className="stack" style={{ width: 360, flex: "0 0 auto" }}>
        <section className="box box--md box--yellow pad stack">
          <div className="heading-row"><h2 className="t-sm">先生からの問いかけ</h2><Tag>AI の提案</Tag></div>
          {insights.length === 0
            ? <p className="t-note">まだ話されていない論点が見つかると、先生がここに出します。</p>
            : insights.map((i) => <p key={i.id} className="t-sm" style={{ borderTop: "3px solid #000", paddingTop: 8 }}>{i.summary}</p>)}
        </section>
        <section className="box box--md pad stack">
          <p className="t-label">グループの結論が出たら</p>
          {!confirming ? (
            <>
              <p className="t-note">だれか1人が押すと、グループ全員が結論を書く画面に進みます。</p>
              <button className="btn btn--blue btn--block" onClick={() => setConfirming(true)}>グループの議論を終える</button>
            </>
          ) : (
            <>
              <p className="t-note">グループのみんなで、結論が出たことを確かめましたか？</p>
              <button className="btn btn--blue btn--block" onClick={endDiscussion} disabled={ending}>{ending ? "終えています…" : "終える"}</button>
              <button className="btn btn--block" onClick={() => setConfirming(false)} disabled={ending}>まだ話す</button>
            </>
          )}
          {error && <p className="notice notice--error" role="alert">{error}</p>}
        </section>
      </aside>
    </div>
  );
}

const AGREEMENT = ["まったく納得していない", "あまり納得していない", "どちらともいえない", "おおむね納得", "とても納得"];

/** P4 結論の理解を入力。本人だけが読み書きできる */
function ConsensusStep({ roomId, uid, title, submitted, total }: { roomId: string; uid: string; title: string; submitted?: number; total?: number }) {
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
      // API 経由で出す。グループ全員がそろうと、API がそのグループの結果を出す
      await callApi(`/rooms/${roomId}/statement`, { text: text.trim(), agreement, ...(concern.trim() ? { concern: concern.trim() } : {}) });
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
        {mine && (
          <div className="notice notice--warn stack stack--tight" role="status">
            <p className="t-label">提出しました。グループのみんなを待っています{total ? `（${submitted ?? 0}/${total}人）` : ""}</p>
            <p className="t-note">全員がそろうと、自動で結果の画面に変わります。</p>
          </div>
        )}
      </form>
    </div>
  );
}

const ACHIEVED = ["できた", "少しできた", "まだ"];
const SPOKE = ["言えた", "一部言えた", "言えなかった", "特になかった"];

/** P4-2 認識のちがい ＋ P5 振り返り。グループの結果は全員に、振り返りはこの端末にだけ残す */
function ResultStep({ roomId, uid, group, source, title, result }: { roomId: string; uid: string; group: number; source?: string; title: string; result: GroupResult | null }) {
  const mine = useDoc<{ text: string }>(`rooms/${roomId}/consensusStatements/${uid}`).data;
  const opinion = useDoc<{ text: string }>(`rooms/${roomId}/privateOpinions/${uid}`).data;
  const [r, setR] = useState(() => getReflection(roomId));
  const [saved, setSaved] = useState(false);
  const set = (patch: Partial<typeof r>) => { setR({ ...r, ...patch }); setSaved(false); };
  const groups = [...(result?.clusters ?? [])].sort((a, b) => b.count - a.count).map((c) => ({ label: c.label, n: c.count }));
  const alignment = result?.alignmentRate ?? null;
  const { flow } = useFlow(roomId, group, source);

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
          <h2 className="t-md">グループで何が起きたか</h2>
          <FlowTimeline flow={flow} compact />
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
          <h2 className="t-md">次はどうするか</h2>
          <GoodReview flow={flow} />
          <Link className="btn" href="/student" style={{ alignSelf: "flex-start" }}>ホームに戻る</Link>
        </>
      )}
    </div>
  );
}
