"use client";
import { GuidedGuest } from "./GuidedGuest";
import { ConsensusStep, DiscussionNotes, OpinionStep, ResultStep } from "./steps";
import { useState } from "react";
import { PHASE_LABEL, Tag, useGeminiSource, type Phase } from "@/components/ui";
import { SessionShell as AppShell } from "@/components/SessionShell";
import { callApi } from "@/lib/api";
import { mmss } from "@/lib/recorder";
import { useAppSession } from "@/lib/session";
import { MAX_RECORDING_MS, useGroupRecording } from "@/lib/recording";
import { recordingPhase } from "@/lib/recording-phase";
import { groupStatus, millis, useDoc, useInsights, useMembers, type GroupResult, type GroupStatus, type Room } from "@/lib/room";

interface Props { roomId: string; room: Room; uid: string; group?: number }

const STEP_OF: Record<GroupStatus, Phase> = { opinions: "collecting", discussing: "discussing", consensus: "consensus", done: "closed" };

/**
 * 参加者（タブレット横向き）の画面。グループはそれぞれのペースで進む：
 * グループを選ぶ → 事前の意見（全員そろうまで待つ）→ 議論 → 結論の一文（全員そろうまで待つ）→ 結果と振り返り
 */
export function ParticipantRoom({ roomId, room, uid, group }: Props) {
  const source = useGeminiSource();
  const [choosing, setChoosing] = useState(false);
  const status = group ? groupStatus(room, group) : "opinions";
  const gs = group ? room.groupState?.[String(group)] : undefined;
  // グループの結果。全員の一文がそろうと API が書く
  const result = useDoc<GroupResult>(group ? `sessions/${roomId}/results/group-${group}` : undefined).data;
  const closed = room.phase === "closed";
  const showResult = !!result || closed || status === "done";
  const writing = !showResult && (status === "consensus" || room.phase === "consensus");
  const discussing = recordingPhase(room, group, status, showResult);
  // 録音は議論の画面を閉じても残し、議論が終わったら送る
  const groupConfig = useDoc<{ recorderUid?: string | null; recorderName?: string | null; name?: string }>(group ? `sessions/${roomId}/groups/${group}` : undefined).data;
  const canRecord = groupConfig !== undefined && (!groupConfig?.recorderUid || groupConfig.recorderUid === uid);
  const recording = useGroupRecording(roomId, discussing && canRecord, gs?.recording?.status, millis(room.endedAt) ?? undefined);
  // 録音中・未送信の録音があるときにホームへ戻ると、録音が消える。確かめてから戻る
  const confirmLeave = () => !recording.unsaved || window.confirm("録音がまだ送られていません。ホームに戻ると、録音は消えます。戻りますか？");
  const phase: Phase = closed ? "closed" : STEP_OF[showResult ? "done" : writing ? "consensus" : status];
  if (room.flowVersion === 1) return <GuidedGuest roomId={roomId} room={room} uid={uid} group={group} recording={recording} canRecord={canRecord} recorder={groupConfig?.recorderUid ? { mine: groupConfig.recorderUid === uid, name: groupConfig.recorderName ?? undefined } : undefined} />;
  return (
    <AppShell hideBack={discussing} eyebrow={group && (room.groups ?? 1) > 1 ? `あなたはグループ${group}` : undefined} title={room.title} back="/home" onLeave={confirmLeave}
      status={PHASE_LABEL[phase]}>
      <div className="flow">
      {!showResult && room.groupSelection !== "host" && (!group || choosing) && <GroupSelect roomId={roomId} room={room} current={group} onDone={() => setChoosing(false)} />}
      {!group && room.groupSelection === "host" && <p className="notice" role="status">ホストによるグループの割り当てを待っています。</p>}
      {groupConfig?.name && <p className="notice">所属：{groupConfig.name}</p>}
      {room.theme && <p className="notice">テーマ：{room.theme}・制限時間：{room.minutes ?? 15}分</p>}
      {!showResult && group && !choosing && status === "opinions" && room.phase !== "consensus" && (
        <OpinionStep roomId={roomId} uid={uid} total={gs?.total} opinions={gs?.opinions} canChange={room.groupSelection !== "host" && (room.groups ?? 1) > 1} onChangeGroup={() => setChoosing(true)} />
      )}
      {discussing && <VoiceStep roomId={roomId} recording={room.recording === false || !canRecord ? null : recording} />}
      {recording.rec.saveError && <p className="notice notice--error" role="alert">{recording.rec.saveError}</p>}
      <RecordingStatus upload={recording.upload} onRetry={recording.retry} />
      {writing && group && <ConsensusStep roomId={roomId} uid={uid} title={room.title} submitted={gs?.submitted} total={gs?.total} />}
      {showResult && group && !room.resultsPublished && <p className="notice" role="status">分析結果はホストが公開すると表示されます。</p>}
      {showResult && group && room.resultsPublished && <ResultStep roomId={roomId} uid={uid} group={group} source={source} title={room.title} result={result ?? null} />}
      {showResult && !group && (
        <div className="body body--center">
          <p className="box box--md pad t-label">この授業は終わりました。グループに入っていなかったので、結果はありません。</p>
        </div>
      )}
      </div>
    </AppShell>
  );
}

/** 参加のあとにグループを選ぶ。議論を始めたグループには入れない */
function GroupSelect({ roomId, room, current, onDone }: { roomId: string; room: Room; current?: number; onDone: () => void }) {
  const members = useMembers(roomId, true).filter((m) => m.role === "participant" && m.status !== "inactive");
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
        <p className="t-label">ホストに言われたグループを選びます。議論が始まる前なら、あとから変えられます。</p>
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
 * recording が null の部屋（Hostが録音しないと決めた部屋）では、録音の画面を出さない。
 * Hostが承認した AI の問いかけだけが届く。
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
        {rec && <p className="t-small">録音はグループで1台だけ。議論を終えると、録音を Gemini に送って議論の流れを分析します。音声はサーバーには保存しません。送るまではこのブラウザに保管し、分析が終わると自動で消します（送れなかった録音も、議論の終了から5分で消します）。だれが話したかは記録しません。共用端末は{lockMinutes}分無操作で録音を停止・保存し、画面をロックします。録音中に画面を閉じたり、ほかのアプリに切り替えたりすると、録音が止まることがあります。</p>}
      </section>
      <aside className="stack" style={{ flex: "1 1 360px", maxWidth: "100%" }}>
        <section className="box box--md box--yellow pad stack">
          <div className="heading-row"><h2 className="t-sm">ホストからの問いかけ</h2><Tag>AI の提案</Tag></div>
          {insights.length === 0
            ? <p className="t-note">まだ話されていない論点があると、ホストがここに表示します。</p>
            : insights.map((i) => <p key={i.id} className="t-sm" style={{ borderTop: "3px solid #000", paddingTop: 8 }}>{i.summary}</p>)}
        </section>
        <DiscussionNotes roomId={roomId} />
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

