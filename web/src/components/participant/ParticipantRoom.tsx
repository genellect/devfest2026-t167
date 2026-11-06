"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FlowTimeline, GoodReview, useFlow } from "@/components/flow";
import { Header, PhaseSteps, SourceTag, Tag, useGeminiSource, type Phase } from "@/components/ui";
import { callApi } from "@/lib/api";
import { formatMetric } from "@/lib/format";
import { getNextGoal, getReflection, saveReflection } from "@/lib/local";
import { mmss } from "@/lib/recorder";
import { useAppSession } from "@/lib/session";
import { MAX_RECORDING_MS, useGroupRecording } from "@/lib/recording";
import { groupStatus, useDoc, useInsights, useMembers, type GroupResult, type GroupStatus, type Room } from "@/lib/room";

interface Props { roomId: string; room: Room; uid: string; group?: number }

const STEP_OF: Record<GroupStatus, Phase> = { opinions: "collecting", discussing: "discussing", consensus: "consensus", done: "closed" };

/**
 * 生徒（タブレット横向き）の画面。グループはそれぞれのペースで進む：
 * グループを選ぶ → 事前の意見（全員そろうまで待つ）→ 議論 → 結論の一文（全員そろうまで待つ）→ 結果と振り返り
 */
export function ParticipantRoom({ roomId, room, uid, group }: Props) {
  const source = useGeminiSource();
  const [choosing, setChoosing] = useState(false);
  const status = group ? groupStatus(room, group) : "opinions";
  const gs = group ? room.groupState?.[String(group)] : undefined;
  // グループの結果。全員の一文がそろうと API が書く
  const result = useDoc<GroupResult>(group ? `rooms/${roomId}/results/group-${group}` : undefined).data;
  const closed = room.phase === "closed";
  const showResult = !!result || closed;
  const writing = !showResult && (status === "consensus" || status === "done" || room.phase === "consensus");
  const discussing = !showResult && !!group && status === "discussing" && room.phase !== "consensus";
  // 録音は議論の画面を閉じても残し、議論が終わったら送る
  const recording = useGroupRecording(roomId, discussing, gs?.recording?.status);
  // 録音中・未送信の録音があるときにホームへ戻ると、録音が消える。確かめてから戻る
  const confirmLeave = (e: React.MouseEvent) => {
    if (recording.unsaved && !window.confirm("録音がまだ送られていません。ホームに戻ると、録音は消えます。戻りますか？")) e.preventDefault();
  };
  return (
    <main className="screen">
      <Header eyebrow={group && (room.groups ?? 1) > 1 ? `あなたはグループ${group}` : undefined} title={room.title} demo={source === "mock"}>
        <PhaseSteps phase={closed ? "closed" : STEP_OF[showResult ? "done" : writing ? "consensus" : status]} />
        <Link className="btn btn--small" href="/student" onClick={confirmLeave}>ホーム</Link>
      </Header>
      {!showResult && (!group || choosing) && <GroupSelect roomId={roomId} room={room} current={group} onDone={() => setChoosing(false)} />}
      {!showResult && group && !choosing && status === "opinions" && room.phase !== "consensus" && (
        <OpinionStep roomId={roomId} uid={uid} total={gs?.total} opinions={gs?.opinions} canChange={(room.groups ?? 1) > 1} onChangeGroup={() => setChoosing(true)} />
      )}
      {discussing && <VoiceStep roomId={roomId} recording={room.recording === false ? null : recording} />}
      {recording.rec.saveError && <p className="notice notice--error" role="alert">{recording.rec.saveError}</p>}
      <RecordingStatus upload={recording.upload} onRetry={recording.retry} />
      {writing && group && <ConsensusStep roomId={roomId} uid={uid} title={room.title} submitted={gs?.submitted} total={gs?.total} />}
      {showResult && group && <ResultStep roomId={roomId} uid={uid} group={group} source={source} title={room.title} result={result ?? null} />}
      {showResult && !group && (
        <div className="body body--center">
          <p className="box box--md pad t-label">この授業は終わりました。グループに入っていなかったので、結果はありません。</p>
        </div>
      )}
    </main>
  );
}

/** 参加のあとにグループを選ぶ。議論を始めたグループには入れない */
function GroupSelect({ roomId, room, current, onDone }: { roomId: string; room: Room; current?: number; onDone: () => void }) {
  const members = useMembers(roomId, true).filter((m) => m.role === "participant");
  const [busy, setBusy] = useState<number>();
  const [error, setError] = useState("");
  async function choose(g: number) {
    setBusy(g); setError("");
    try { await callApi(`/rooms/${roomId}/groups/choose`, { group: g }); onDone(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(undefined); }
  }
  return (
    <div className="body body--tablet">
      <div className="stack stack--tight">
        <h2 className="t-lg">あなたのグループを選んでください</h2>
        <p className="t-label">先生に言われたグループを選びます。議論が始まる前なら、あとから変えられます。</p>
      </div>
      {error && <p className="notice notice--error" role="alert">{error}</p>}
      <div className="grid-auto">
        {Array.from({ length: room.groups ?? 1 }, (_, i) => i + 1).map((g) => {
          const started = groupStatus(room, g) !== "opinions";
          const n = members.filter((m) => m.group === g).length;
          return (
            <button key={g} className={`box box--md group-card${current === g ? " box--yellow" : ""}`} style={{ textAlign: "left", cursor: started ? "not-allowed" : "pointer" }}
              disabled={started || busy !== undefined} onClick={() => choose(g)} aria-pressed={current === g}>
              <span className="t-lg">グループ{g}</span>
              <span className="t-small">{started ? "議論が始まっています" : `${n}人が参加中`}{current === g ? "・あなたのグループ" : ""}</span>
              {busy === g && <span className="t-small">選んでいます…</span>}
            </button>
          );
        })}
      </div>
      {current && <button className="btn" style={{ alignSelf: "flex-start" }} onClick={onDone}>グループ{current}のまま戻る</button>}
    </div>
  );
}

/** P2 目標と意見の入力。意見は本人だけが読める（司会者も読めない）。目標はこの端末にだけ残す。
 * 出したあとは、グループ全員がそろうまで待つ（そろうと自動で議論の画面に変わる） */
function OpinionStep({ roomId, uid, total, opinions, canChange, onChangeGroup }: {
  roomId: string; uid: string; total?: number; opinions?: number; canChange: boolean; onChangeGroup: () => void;
}) {
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
      // API 経由で出す。グループ全員がそろうと、API がそのグループの議論を始める
      await callApi(`/rooms/${roomId}/opinion`, { text: opinion.trim() });
      setSent(true);
    } catch (err) { setError(`提出できませんでした：${(err as Error).message}`); }
  }

  return (
    <div className="body body--center">
      <form className="box box--lg card" onSubmit={submit}>
        <div className="heading-row">
          <h2 className="card__title">議論の前に書く</h2>
          {canChange && !mine && <button type="button" className="btn btn--small" onClick={onChangeGroup}>グループを選び直す</button>}
        </div>
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
        {mine && (
          <div className="notice notice--warn stack stack--tight">
            <p className="t-label">グループのみんなの意見を待っています{total ? `（${opinions ?? 0}/${total}人）` : ""}</p>
            <p className="t-note">全員がそろうと、自動で議論の画面に変わります。それまでは書き直せます。</p>
          </div>
        )}
      </form>
    </div>
  );
}

/** 議論のあと、録音の分析の状態を出す。失敗したら、端末に残した録音を送り直せる */
function RecordingStatus({ upload, onRetry }: { upload: ReturnType<typeof useGroupRecording>["upload"]; onRetry: () => void }) {
  if (upload.state === "none") return null;
  const text = {
    uploading: "録音を送り、議論の流れを分析しています（数分かかります）。そのまま進めてください。",
    waiting: upload.message ?? "グループの別の送信を分析しています。",
    done: upload.message ?? "録音の分析が終わりました。結果の画面の「グループで何が起きたか」で見られます。",
    failed: `録音を分析できませんでした：${upload.message ?? ""}`,
  }[upload.state];
  return (
    <div className="body body--center" style={{ paddingBottom: 0 }}>
      <div className={`notice${upload.state === "failed" ? " notice--error" : upload.state === "uploading" || upload.state === "waiting" ? " notice--warn" : ""}`}
        role={upload.state === "failed" ? "alert" : "status"} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", justifyContent: "space-between", width: "min(720px, 100%)" }}>
        <span className="t-label">{text}</span>
        {upload.state === "failed" && <button className="btn btn--blue btn--small" onClick={onRetry}>もう一度送る</button>}
      </div>
    </div>
  );
}

/**
 * P3 議論（音声）。録音はグループで1台。グループ全員の同意を確かめてから始め、画面を見なくても話し合えるようにする。
 * 議論を終えると、録音している端末が音声を API に送り、Gemini が議論の流れを分析する（音声は保存しない）。
 * recording が null の部屋（先生が録音しないと決めた部屋）では、録音の画面を出さない。
 * 先生が承認した AI の問いかけだけが届く。
 */
function VoiceStep({ roomId, recording }: { roomId: string; recording: ReturnType<typeof useGroupRecording> | null }) {
  const insights = useInsights(roomId, true, true);
  const rec = recording?.rec;
  const lockMinutes = useAppSession().policy?.sharedIdleMinutes ?? 15;
  const [consent, setConsent] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState("");
  async function endDiscussion() {
    setEnding(true); setError("");
    // 議論が終わると、録音している端末が止めて送る（useGroupRecording）
    try { await callApi(`/rooms/${roomId}/groups/end`); }
    catch (e) { setError((e as Error).message); setEnding(false); }
  }
  const scale = 1 + (rec?.level ?? 0) * 0.45;
  const state = rec?.state ?? "idle";
  const status = !rec ? "この部屋では録音しません。そのまま話し合ってください。" : {
    idle: "録音を始めると、議論が終わるまで（最長30分）記録します。",
    asking: "マイクの使用を許可してください。",
    recording: `録音中・議論を続けてください（${mmss(MAX_RECORDING_MS)}で自動で止まります）`,
    paused: "一時停止中",
    stopped: "録音を終えました。話し合いはそのまま続けられます。",
    denied: "マイクが使えません。ブラウザの設定でマイクを許可してから、もう一度試してください。",
    unsupported: "この端末やブラウザでは録音できません。別の端末で録音するか、そのまま話し合ってください。",
  }[state];

  return (
    // スマホの幅では、録音と「議論を終える」を縦に並べる（横に並べると重なって押せない）
    <div className="body body--tablet" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "stretch" }}>
      <section className="box box--lg pad-lg stack" style={{ flex: "999 1 320px", minWidth: 0, alignItems: "center", justifyContent: "center", gap: 24, textAlign: "center" }}>
        <h2 className="t-lg">グループで話し合いましょう</h2>
        <p className="t-label">議論が終わるまで、画面を見なくても大丈夫です。</p>
        <div className="voice" data-state={state} aria-hidden="true">
          <div className="voice__ring" style={{ transform: `scale(${state === "recording" ? scale : 0.82})` }} />
          <div className="voice__core">{rec && (state === "recording" || state === "paused") ? mmss(rec.elapsedMs) : "マイク"}</div>
        </div>
        <div className={`notice${state === "denied" || state === "unsupported" ? " notice--error" : state === "recording" ? "" : " notice--warn"}`}
          role="status" style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", width: "min(560px, 100%)", justifyContent: "space-between", textAlign: "left" }}>
          <span className="t-label">{status}</span>
          {rec && (state === "idle" || state === "denied") && <button className="btn btn--blue btn--small" onClick={rec.start} disabled={!consent}>{state === "denied" ? "もう一度試す" : "録音を始める"}</button>}
          {rec && state === "recording" && <button className="btn btn--small" onClick={rec.pause}>一時停止</button>}
          {rec && state === "paused" && <button className="btn btn--blue btn--small" onClick={rec.resume}>再開する</button>}
        </div>
        {rec && (state === "idle" || state === "denied") && (
          <label className="t-label" style={{ display: "flex", gap: 10, alignItems: "flex-start", width: "min(560px, 100%)", textAlign: "left" }}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ width: 24, height: 24, flex: "0 0 auto" }} />
            <span>グループ全員が、録音することに同意しました</span>
          </label>
        )}
        {rec && <p className="t-small">録音はグループで1台だけ。議論を終えると、録音を Gemini に送って議論の流れを分析します。音声はサーバーには保存しません。このブラウザには保管するので、「端末とセッション」で確認して削除してください。だれが話したかは記録しません。共用端末は{lockMinutes}分無操作で録音を停止・保存し、画面をロックします。録音中に画面を閉じたり、ほかのアプリに切り替えたりすると、録音が止まることがあります。</p>}
      </section>
      <aside className="stack" style={{ flex: "1 1 360px", maxWidth: "100%" }}>
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
