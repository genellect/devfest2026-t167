"use client";
import Link from "next/link";
import { SpeakerCapture } from "@/lib/speaker-capture";
import { GuestSpeaking } from "@/components/Speaking";
import { useEffect, useRef, useState } from "react";
import { callApi } from "@/lib/api";
import { authenticatedFetch } from "@/lib/session";
import { useDoc, useCountdown, useInsights, millis, type Room, type GroupResult } from "@/lib/room";
import { ConsensusStep, DiscussionNotes, OpinionStep, ResultStep } from "./steps";
import type { useGroupRecording } from "@/lib/recording";
import { registerRecordingGuard } from "@/lib/recording-recovery";
interface Own { voiceSource?: "mock" | "model"; displayName?: string; deviceMode?: "personal" | "shared"; ready?: boolean; attendees?: { id: string; displayName: string; voiceRegistered: boolean }[] }
export function GuidedGuest({ roomId, room, uid, group, recording, canRecord }: { roomId: string; room: Room; uid: string; group?: number; recording: ReturnType<typeof useGroupRecording>; canRecord: boolean }) {
  const own = useDoc<Own>(`sessions/${roomId}/members/${uid}`).data;
  // 合意の一文から出るグループの結果（終了後）と、教員が承認した問いかけ（議論中）
  const result = useDoc<GroupResult>(group ? `sessions/${roomId}/results/group-${group}` : undefined).data;
  const insights = useInsights(roomId, true, true);
  const status = group ? room.groupState?.[String(group)]?.status : undefined;
  // 音声登録は任意。「あとで登録する」を選んだことはこの端末に覚えておく
  const skipKey = `t167:voice-skip:${roomId}:${uid}`;
  const [voiceSkipped, setVoiceSkipped] = useState(false);
  useEffect(() => { try { setVoiceSkipped(localStorage.getItem(skipKey) === "1"); } catch { /* 保存できなくても進める */ } }, [skipKey]);
  const skipVoice = () => { try { localStorage.setItem(skipKey, "1"); } catch { /* 保存できなくても進める */ } setVoiceSkipped(true); };
  const [names, setNames] = useState([""]), [mode, setMode] = useState<"personal" | "shared">("personal");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [registering, setRegistering] = useState<string>(), [consent, setConsent] = useState(false);
  const [registrationSeconds, setRegistrationSeconds] = useState(0);
  const [registrationMode, setRegistrationMode] = useState<"mic" | "file">("mic");
  const [recordingConsent, setRecordingConsent] = useState(false);
  const stream = useRef<MediaStream | undefined>(undefined), sample = useRef<MediaRecorder | undefined>(undefined);
  const { state: recorderState, capture: recordingCapture } = recording.rec;
  const [speakerStatus, setSpeakerStatus] = useState("");
  useEffect(() => {
    if (recorderState !== "recording" || !canRecord || room.endedAt) return;
    const capture = recordingCapture();
    if (!capture.stream || !capture.context) return;
    const speaker = new SpeakerCapture(roomId, setSpeakerStatus);
    setSpeakerStatus("登録した声と照合しています（推定）。");
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
        const response = await authenticatedFetch(`/rooms/${roomId}/voice/${id}?consent=1`, { method: "POST", headers: { "content-type": "audio/pcm" }, body: pcm.buffer });
        const data = await response.json(); if (!response.ok) throw new Error(data.error?.message ?? "音声を登録できませんでした");
      } finally { pcm.fill(0); samples.fill(0); }
    } catch (e) { setError((e as Error).message); }
    finally { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = undefined; setRegistering(undefined); }
  }
  useEffect(() => { if (clock.over && room.phase === "discussing" && !room.endedAt) void callApi(`/rooms/${roomId}/check-time`).catch(() => {}); }, [clock.over, room.phase, room.endedAt, roomId]);
  const ended = !!room.endedAt || room.phase === "closed";
  const waiting = room.phase === "collecting";
  const named = !!own?.attendees?.length;
  const voiced = !!own?.ready || voiceSkipped;
  const gs = group ? room.groupState?.[String(group)] : undefined;
  // 進み具合：表示名 → 声 → 意見 → 議論 → 一文 → 結果
  const STEPS = ["表示名", "声", "意見", "議論", "一文", "結果"];
  const step = ended ? (result || status === "done" ? 5 : 4) : !named ? 0 : !voiced ? 1 : waiting ? 2 : 3;
  const shared = own?.deviceMode === "shared";
  const leave = (e: React.MouseEvent) => { if (recording.unsaved && !window.confirm("録音がまだ送られていません。ホームに戻ると、録音は送られず分析されません。戻りますか？")) e.preventDefault(); };
  const uploadState = recording.upload.state;
  return <main className="screen">
    <header className="appbar">
      <div className="appbar__title">
        <p className="appbar__who">{own?.displayName ?? "参加の準備"}{group && (room.groups ?? 1) > 1 ? `・グループ${group}` : ""}</p>
        <h1 className="appbar__theme">{room.participantView?.theme === false ? room.title : room.theme || room.title}</h1>
      </div>
      <Link href="/home" className="btn btn--small" onClick={leave}>ホームに戻る</Link>
    </header>
    <ol className="track" aria-label="進み具合">
      {STEPS.map((label, i) => <li key={label} aria-current={i === step ? "step" : undefined} data-done={i < step}>{label}</li>)}
    </ol>
    <div className="flow">
      {error && <p className="notice notice--error" role="alert">{error}</p>}

      {ended ? <>
        <p className="notice" role="status">{room.endReason === "timeout" ? "設定した時間になりました。" : "教員がディスカッションを終了しました。"}</p>
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
        <h2 id="voice-title" className="flow-card__title">初回の音声登録</h2>
        <p className="flow-card__lead">{shared ? "1人ずつ、次の文を9秒で読み上げてください。" : "次の文を9秒で読み上げてください。"}</p>
        <p className="read-aloud">私たちは、お互いの意見を聞き、理由を考えながら、よりよいアイデアを見つけます。</p>
        <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>声の特徴の登録と、上記の利用方法に同意します</span></label>
        <p className="t-small">{shared ? "話し合いの発言時間の推定に使い、セッションの終了時に削除します。" : "話し合いの発言時間の推定に使います。声の特徴だけをこのアカウントに保存し、次回も使います。音声そのものは保存しません。"}</p>
        {own!.attendees!.map((a) => <div className="stack stack--tight" key={a.id}>
          {own!.attendees!.length > 1 && <p className="t-label">{a.displayName}</p>}
          <button className="mic" data-done={a.voiceRegistered || undefined} disabled={!consent || !!registering || a.voiceRegistered} onClick={() => void enroll(a.id)}>
            {a.voiceRegistered ? "登録済み" : registering === a.id ? (registrationMode === "mic" ? "読み上げてください" : "音声を登録しています…") : "声を登録する"}
            {registering === a.id && registrationMode === "mic" && <span className="mic__meter" role="progressbar" aria-label={`${a.displayName}の音声登録の進捗`} aria-valuemin={0} aria-valuemax={9} aria-valuenow={registrationSeconds}><span style={{ width: `${(registrationSeconds / 9) * 100}%` }} /></span>}
          </button>
          <details><summary className="t-small">録音済みの音声から登録する</summary><p className="t-small">本人だけが話す8〜12秒、1MB以内の音声を選んでください。</p><input type="file" accept="audio/*" aria-label={`${a.displayName}の登録用音声ファイル`} disabled={!consent || !!registering || a.voiceRegistered} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void enroll(a.id, file); }} /></details>
        </div>)}
        {own!.voiceSource === "mock" && <p className="t-small">ローカルでは音声登録のモックを使います。実際の声の識別精度を表すものではありません。</p>}
        <button type="button" className="text-btn" disabled={!!registering} onClick={skipVoice}>あとで登録する</button>
      </section>

      : waiting ? (!group
        ? <p className="notice" role="status">グループの割り当てを待っています。</p>
        : <OpinionStep bare roomId={roomId} uid={uid} total={gs?.total} opinions={gs?.opinions} canChange={false} onChangeGroup={() => {}} />)

      : <>
        <section className="flow-card" aria-labelledby="talk-title">
          <h2 id="talk-title" className="flow-card__title">グループで話し合いましょう</h2>
          {room.participantView?.theme !== false && room.theme && <p>テーマ：{room.theme}</p>}
          {room.participantView?.timer !== false && room.endsAt && <p role="timer">残り時間 {clock.text}</p>}
          {canRecord && room.recording !== false && <>
            <label className="check"><input type="checkbox" checked={recordingConsent} onChange={(e) => { setRecordingConsent(e.target.checked); if (!e.target.checked) void recording.discard(); }} /><span>グループ全員が録音・声の照合・発言時間の集計に同意しました</span></label>
            <p className="t-small">録音はグループで1台です。同意を取り消すと、ここまでの録音は送らずに削除します。</p>
            <button className="btn btn--blue btn--block" disabled={!recordingConsent || ["asking", "recording", "stopped"].includes(recording.rec.state)} onClick={() => void recording.rec.start()}>{recording.rec.state === "recording" ? "録音中" : recording.rec.state === "stopped" ? "録音は停止済みです" : "録音を始める"}</button>
            {recorderState === "recording" && <button className="btn btn--block" onClick={() => void recording.rec.stop()}>録音を停止して端末に保管</button>}
          </>}
          {!canRecord && room.recording !== false && <p className="t-small">録音は、教員が指定した別の端末が担当します。</p>}
          {speakerStatus && <p className="t-small" role="status">{speakerStatus}</p>}
          {recording.rec.saveError && <p className="notice notice--error" role="alert">{recording.rec.saveError}</p>}
        </section>
        <section className="sticky" aria-label="教員からの問いかけ">
          <p className="sticky__label">教員からの問いかけ</p>
          {insights.length === 0 ? <p className="t-note">まだ話されていない論点があると、教員がここに表示します。</p>
            : insights.map((i) => <p key={i.id} className="sticky__text">{i.summary}</p>)}
        </section>
        <DiscussionNotes bare roomId={roomId} />
      </>}

      {group && room.participantView?.speaking === true && (!ended || room.resultsPublished) && <GuestSpeaking roomId={roomId} group={group} />}
    </div>
  </main>;
}
