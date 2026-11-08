"use client";
import { ParticipantSession, ParticipantWaiting } from "./ParticipantSession";
import { Loading } from "@/components/ui";
import { PersonalEvidence, GroupEvidence } from "@/components/analysis/EvidenceAnalysis";
import { AppShell, Stepper } from "@/components/shell";
import { SpeakerCapture } from "@/lib/speaker-capture";
import { GuestSpeaking } from "@/components/Speaking";
import { useEffect, useRef, useState } from "react";
import { callApi } from "@/lib/api";
import { authenticatedFetch } from "@/lib/session";
import { useDoc, useCountdown, useInsights, millis, type Room, type GroupResult } from "@/lib/room";
import { ConsensusStep, DiscussionNotes, ResultStep } from "./steps";
import type { useGroupRecording } from "@/lib/recording";
import { registerRecordingGuard } from "@/lib/recording-recovery";
interface Own { voiceSource?: "mock" | "model"; displayName?: string; deviceMode?: "personal" | "shared"; ready?: boolean; attendees?: { id: string; displayName: string; voiceRegistered: boolean }[] }
export function GuidedGuest({ roomId, room, uid, group, recording, canRecord }: { roomId: string; room: Room; uid: string; group?: number; recording: ReturnType<typeof useGroupRecording>; canRecord: boolean }) {
  const own = useDoc<Own>(`sessions/${roomId}/members/${uid}`).data;
  // 合意の一文から出るグループの結果（終了後）と、教員が承認した問いかけ（議論中）
  const result = useDoc<GroupResult>(group ? `sessions/${roomId}/results/group-${group}` : undefined).data;
  const insights = useInsights(roomId, true, true);
  const status = group ? room.groupState?.[String(group)]?.status : undefined;
  const [names, setNames] = useState([""]), [mode, setMode] = useState<"personal" | "shared">("personal");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [registering, setRegistering] = useState<string>();
  const [registrationSeconds, setRegistrationSeconds] = useState(0);
  const [registrationMode, setRegistrationMode] = useState<"mic" | "file">("mic");
  const stream = useRef<MediaStream | undefined>(undefined), sample = useRef<MediaRecorder | undefined>(undefined);
  const { state: recorderState, capture: recordingCapture } = recording.rec;
  const [speakerStatus, setSpeakerStatus] = useState("");
  useEffect(() => {
    if (recorderState !== "recording" || !canRecord || room.endedAt) return;
    const capture = recordingCapture();
    if (!capture.stream || !capture.context) return;
    const speaker = new SpeakerCapture(roomId, setSpeakerStatus);
    setSpeakerStatus("声の違いから発言時間を集計しています（推定）。");
    void speaker.start(capture.stream, capture.context).catch((e: Error) => { setSpeakerStatus(e.message); void speaker.stop(); });
    const off = registerRecordingGuard(() => speaker.stop());
    return () => { off(); void speaker.stop(); };
  }, [recorderState, recordingCapture, canRecord, room.endedAt, roomId]);
  const clock = useCountdown(millis(room.startedAt), room.minutes ?? 15);
  useEffect(() => {
    const stop = async () => { if (sample.current?.state === "recording") sample.current.stop(); stream.current?.getTracks().forEach((t) => t.stop()); };
    const off = registerRecordingGuard(stop); return () => { off(); void stop(); };
  }, []);
  async function saveNames(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try { await callApi(`/rooms/${roomId}/onboarding`, { mode, names: names.map((n) => n.trim()) }); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function enroll(id: string, file?: File) {
    setRegistering(id); setError(""); setRegistrationSeconds(0); setRegistrationMode(file ? "file" : "mic");
    try {
      if (file && file.size > 1024 * 1024) throw new Error("登録用音声は1MB以内、8〜12秒にしてください");
      let blob: Blob;
      if (file) blob = file;
      else {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("マイクを使うにはHTTPSまたはlocalhostで開いてください。録音済みの音声ファイルからも登録できます。");
      const input = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); stream.current = input;
      const recorder = new MediaRecorder(input); sample.current = recorder;
      blob = await new Promise<Blob>((resolve, reject) => {
        const chunks: Blob[] = []; recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        const started = Date.now(); const progressTimer = setInterval(() => setRegistrationSeconds(Math.min(9, Math.floor((Date.now() - started) / 1000))), 200); const timer = setTimeout(() => { if (recorder.state === "recording") recorder.stop(); }, 9000);
        recorder.onstop = () => { clearTimeout(timer); clearInterval(progressTimer); if (Date.now() - started < 8000) reject(new Error("音声登録が中断されました。もう一度登録してください")); else resolve(new Blob(chunks, { type: recorder.mimeType })); };
        recorder.onerror = () => { clearTimeout(timer); clearInterval(progressTimer); reject(new Error("録音できませんでした")); }; recorder.start();
      });
      input.getTracks().forEach((t) => t.stop());
      }
      const context = new AudioContext(); let decoded: AudioBuffer;
      try { decoded = await context.decodeAudioData(await blob.arrayBuffer()); } finally { await context.close(); }
      if (decoded.duration < 8 || decoded.duration > 12) throw new Error("8〜12秒の音声を、1人ずつ登録してください");
      const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000), source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
      const samples = (await offline.startRendering()).getChannelData(0), pcm = new Int16Array(samples.length);
      for (let i = 0; i < samples.length; i++) pcm[i] = Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767);
      try {
        const response = await authenticatedFetch(`/rooms/${roomId}/voice/${id}`, { method: "POST", headers: { "content-type": "audio/pcm" }, body: pcm.buffer });
        const data = await response.json(); if (!response.ok) throw new Error(data.error?.message ?? "音声を登録できませんでした");
      } finally { pcm.fill(0); samples.fill(0); }
    } catch (e) { setError(e instanceof DOMException && e.name === "NotAllowedError" ? "マイクの使用をブラウザで許可して、もう一度お試しください。" : (e as Error).message); }
    finally { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = undefined; setRegistering(undefined); }
  }
  useEffect(() => { if (room.endsAt && clock.over && room.phase === "discussing" && !room.endedAt) void callApi(`/rooms/${roomId}/check-time`).catch(() => {}); }, [room.endsAt, clock.over, room.phase, room.endedAt, roomId]);
  const ended = !!room.endedAt || room.phase === "closed";
  const waiting = room.phase === "collecting";
  const named = !!own?.attendees?.length;
  const voiced = own?.deviceMode === "shared" || (!!own?.ready && !!own?.attendees?.every(a => a.voiceRegistered));
  const gs = group ? room.groupState?.[String(group)] : undefined;
  // 表示名・音声登録 → 開始待ち → 議論 → 結論 → 結果
  const STEPS = ["参加準備", "議論", "結論", "結果"];
  const step = ended ? (result || status === "done" ? 3 : 2) : !named || !voiced || waiting ? 0 : 1;
  const shared = own?.deviceMode === "shared";
  const question = (
    <section className="sticky" aria-label="教員からの問いかけ">
      <p className="sticky__label">教員からの問いかけ</p>
      {insights.length === 0 ? <p className="t-note">まだ話されていない論点があると、教員がここに表示します。</p>
        : insights.map((i) => <p key={i.id} className="sticky__text">{i.summary}</p>)}
    </section>
  );
  const leave = () => !recording.unsaved || window.confirm("録音がまだ送られていません。ホームに戻ると、録音は送られず分析されません。戻りますか？");
  const uploadState = recording.upload.state;
  const who = [own?.displayName, group && (room.groups ?? 1) > 1 ? `グループ${group}` : ""].filter(Boolean).join("・");
  if (own === undefined) return <Loading />;
  if (!ended && !waiting && named && voiced && group) return <ParticipantSession roomId={roomId} room={room} recording={recording} canRecord={canRecord} speakerStatus={speakerStatus} onLeave={leave}>
    {question}
    {room.participantView?.speaking === true && group && <GuestSpeaking roomId={roomId} group={group} />}
    <details><summary>発言メモ</summary><DiscussionNotes bare roomId={roomId} /></details>
  </ParticipantSession>;
  return <AppShell eyebrow={who || undefined} title={room.participantView?.theme === false ? room.title : room.theme || room.title}
    steps={<Stepper steps={STEPS} current={step} />} back="/home" onLeave={leave}>
    <div className="flow" style={{paddingBottom:112}}>
      {ended && room.resultsPublished && <><PersonalEvidence roomId={roomId} uid={uid} published={!!room.resultsPublished} />{group && <GroupEvidence roomId={roomId} group={group} />}</>}
      {error && <p className="notice notice--error" role="alert">{error}</p>}

      {ended ? <>
        <p className="notice" role="status">{room.endReason === "timeout" ? "設定した時間になりました。" : "教員が議論を終了しました。"}</p>
        {["uploading", "waiting", "done"].includes(uploadState) && <p className="notice" role="status">{uploadState === "done" ? "録音の送信・分析が完了しました。" : uploadState === "waiting" ? "グループの分析結果を待っています。録音は端末に保持しています。" : "録音を送信して分析しています。画面を閉じずにお待ちください。"}</p>}
        {uploadState === "failed" && <div className="notice notice--error stack"><p role="alert">{recording.upload.message}</p><button className="btn" onClick={() => void recording.retry()}>録音を再送する</button></div>}
        {!group ? <p className="notice">グループに入っていなかったため、結果はありません。</p>
          : !result && status !== "done" ? <ConsensusStep bare roomId={roomId} uid={uid} title={room.theme || room.title} submitted={gs?.submitted} total={gs?.total} />
          : !room.resultsPublished ? <p className="notice">結果は教員が公開すると表示されます。</p>
          : <ResultStep roomId={roomId} uid={uid} group={group} title={room.theme || room.title} result={result ?? null} />}
      </>

      : !named ? <form className="flow-card" onSubmit={saveNames}>
        <h2 className="flow-card__title">表示名を設定</h2>
        <div className="choices" role="group" aria-label="参加する端末">
          <button type="button" className="choice" aria-pressed={mode === "personal"} onClick={() => { setMode("personal"); setNames([names[0] ?? ""]); }}>自分の端末で参加</button>
          <button type="button" className="choice" aria-pressed={mode === "shared"} onClick={() => setMode("shared")}>1台を複数人で使う</button>
        </div>
        {names.map((name, i) => <div className="field" key={i}>
          <label className="field__label" htmlFor={`name-${i}`}>参加者{i + 1}の表示名</label>
          <input id={`name-${i}`} className="input" maxLength={40} required autoComplete="nickname" value={name} onChange={(e) => setNames(names.map((v, n) => n === i ? e.target.value : v))} />
        </div>)}
        {mode === "shared" && <button type="button" className="text-btn" disabled={names.length >= 12} onClick={() => setNames([...names, ""])}>参加者を追加</button>}
        <button className="btn btn--blue btn--block" disabled={busy || names.some((n) => !n.trim())}>表示名を保存して進む</button>
      </form>

      : !voiced ? <section className="flow-card" aria-labelledby="voice-title">
        <h2 id="voice-title" className="flow-card__title">声の登録</h2>
        <p className="flow-card__lead">{shared ? "1人ずつ、いつもの声で9秒ほど自由に話してください。" : "いつもの声で9秒ほど自由に話してください。"}</p>
        <details><summary className="t-small">声の使い方</summary><p className="t-small">{shared ? "話し合いの発言時間の推定に使い、セッションの終了時に削除します。" : "話し合いの発言時間の推定に使います。声の特徴だけをこのアカウントに保存し、次回も使います。音声そのものは保存しません。"}</p></details>
        {own!.attendees!.map((a) => <div className="stack stack--tight" key={a.id}>
          {own!.attendees!.length > 1 && <p className="t-label">{a.displayName}</p>}
          <button className="mic" data-done={a.voiceRegistered || undefined} disabled={!!registering || a.voiceRegistered} onClick={() => void enroll(a.id)}>
            {a.voiceRegistered ? "登録済み" : registering === a.id ? (registrationMode === "mic" ? "自由に話してください" : "音声を登録しています…") : "声を登録する"}
            {registering === a.id && registrationMode === "mic" && <span className="mic__meter" role="progressbar" aria-label={`${a.displayName}の音声登録の進捗`} aria-valuemin={0} aria-valuemax={9} aria-valuenow={registrationSeconds}><span style={{ width: `${(registrationSeconds / 9) * 100}%` }} /></span>}
          </button>
          <details><summary className="t-small">録音済みの音声から登録する</summary><p className="t-small">本人だけが話す8〜12秒、1MB以内の音声を選んでください。</p><input type="file" accept="audio/*" aria-label={`${a.displayName}の登録用音声ファイル`} disabled={!!registering || a.voiceRegistered} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void enroll(a.id, file); }} /></details>
        </div>)}
        {own!.voiceSource === "mock" && <p className="t-small">ローカルでは音声登録のモックを使います。実際の声の識別精度を表すものではありません。</p>}
        <p className="t-small">登録が完了すると、開始待ちの画面へ進みます。各自の端末で参加する場合は登録が必要です。</p>
      </section>

      : waiting ? (!group
        ? <p className="notice" role="status">グループの割り当てを待っています。</p>
        : <ParticipantWaiting roomId={roomId} room={room} uid={uid} group={group} />)

      : null}

      {group && room.participantView?.speaking === true && ended && room.resultsPublished && <GuestSpeaking roomId={roomId} group={group} />}
    </div>
  </AppShell>;
}
