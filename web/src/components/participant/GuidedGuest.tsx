"use client";
import Link from "next/link";
import { SpeakerCapture } from "@/lib/speaker-capture";
import { GuestSpeaking } from "@/components/Speaking";
import { useEffect, useRef, useState } from "react";
import { callApi } from "@/lib/api";
import { authenticatedFetch } from "@/lib/session";
import { useDoc, useCountdown, millis, type Room, type Flow } from "@/lib/room";
import type { useGroupRecording } from "@/lib/recording";
import { registerRecordingGuard } from "@/lib/recording-recovery";
interface Own { voiceSource?: "mock" | "model"; displayName?: string; deviceMode?: "personal" | "shared"; ready?: boolean; attendees?: { id: string; displayName: string; voiceRegistered: boolean }[] }
export function GuidedGuest({ roomId, room, uid, group, recording, canRecord }: { roomId: string; room: Room; uid: string; group?: number; recording: ReturnType<typeof useGroupRecording>; canRecord: boolean }) {
  const own = useDoc<Own>(`sessions/${roomId}/members/${uid}`).data;
  const result = useDoc<Flow>(group ? `sessions/${roomId}/results/flow-g${group}` : undefined).data;
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
  async function choose(group: number) { try { await callApi(`/rooms/${roomId}/groups/choose`, { group }); } catch (e) { setError((e as Error).message); } }
  return <main className="screen"><header className="header"><div><p>Guest · {own?.displayName ?? "参加準備"}</p><h1>{room.title}</h1></div><Link href="/home" className="btn" onClick={(e) => { if (recording.unsaved && !window.confirm("録音がまだ送られていません。ホームに戻ると、録音は送られず分析されません。戻りますか？")) e.preventDefault(); }}>ホームに戻る</Link></header><div className="body">
    {error && <p role="alert">{error}</p>}
    {ended ? <section className="box pad-lg stack"><h2>ディスカッションの結果</h2><p>{room.endReason === "timeout" ? "設定した時間になりました。" : "Hostがディスカッションを終了しました。"}</p>
      {!room.resultsPublished ? <p>結果はHostの公開後に表示されます。</p> : result ? <><p>{result.flowNote}</p><h3>よかった点</h3>{result.good?.map((p, i) => <p key={i}>{p.text}</p>)}<h3>振り返るポイント</h3>{result.review?.map((p, i) => <p key={i}>{p.text}</p>)}<p>{result.source === "mock" ? "デモデータ" : "Geminiによる推定"}</p></> : <p>録音の送信・分析結果を待っています。録音しなかった場合は分析結果がありません。</p>}
      {["uploading", "waiting", "done"].includes(recording.upload.state) && <p role="status">{recording.upload.state === "done" ? "録音の送信・分析が完了しました。" : recording.upload.state === "waiting" ? "グループの分析結果を待っています。録音は端末に保持しています。" : "録音を送信して分析しています。画面を閉じずにお待ちください。"}</p>}
      {recording.upload.state === "failed" && <><p role="alert">{recording.upload.message}</p><button className="btn" onClick={() => void recording.retry()}>録音を再送する</button></>}
    </section> : !own?.attendees?.length ? <form className="box pad-lg stack" onSubmit={saveNames}><h2>表示名を設定</h2>
      <label className="field">参加する端末<select value={mode} onChange={(e) => { setMode(e.target.value as "personal" | "shared"); setNames([""]); }}><option value="personal">各自の端末で参加</option><option value="shared">1台の端末で複数人が参加</option></select></label>
      {names.map((name, i) => <label className="field" key={i}>参加者{i + 1}の表示名<input maxLength={40} required value={name} onChange={(e) => setNames(names.map((v, n) => n === i ? e.target.value : v))} /></label>)}
      {mode === "shared" && <button type="button" className="btn" disabled={names.length >= 12} onClick={() => setNames([...names, ""])}>この端末の参加者を追加</button>}
      <button className="btn btn--blue" disabled={busy || names.some((n) => !n.trim())}>表示名を保存して進む</button>
    </form> : !own.ready ? <section className="box pad-lg stack"><h2>初回の音声登録</h2><p>{own.deviceMode === "shared" ? "この端末の参加者全員を、1人ずつ毎回登録します。登録情報はセッション終了後に削除します。" : "このGoogleアカウントに声の特徴を登録し、次回から再利用します。元の音声は保存しません。"}</p><p>「私たちは、お互いの意見を聞き、理由を考えながら、よりよいアイデアを見つけます。」を9秒間、1人だけで読んでください。</p>
      <label><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />声の特徴の登録と、上記の利用方法に同意します</label>
      {own.attendees.map((a) => <div className="box pad stack" key={a.id}><strong>{a.displayName}</strong><button className="btn" disabled={!consent || !!registering || a.voiceRegistered} onClick={() => void enroll(a.id)}>{a.voiceRegistered ? "登録済み" : registering === a.id ? (registrationMode === "mic" ? "読み上げてください（9秒）…" : "音声を登録しています…") : "声を登録する"}</button>{registering === a.id && registrationMode === "mic" && <><progress aria-label={`${a.displayName}の音声登録の進捗`} value={registrationSeconds} max={9} /><p role="status">{registrationSeconds} / 9秒</p></>}<details><summary>録音済みの音声から登録</summary><p>本人だけが話す8〜12秒、1MB以内の音声を選択してください。元の音声ファイルはサーバーに保存しません。</p><input type="file" accept="audio/*" aria-label={`${a.displayName}の登録用音声ファイル`} disabled={!consent || !!registering || a.voiceRegistered} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void enroll(a.id, file); }} /></details></div>)}
      {own.voiceSource === "mock" && <p>ローカルでは音声登録のモックを使用します。実際の声の識別精度を表すものではありません。</p>}
    </section> : waiting ? <section className="box pad-lg stack"><h2>待機画面</h2><p>Hostのディスカッション開始を待っています。</p><p>表示名：{own.attendees.map((a) => a.displayName).join("、")}</p>
      {group ? <p>所属：グループ{group}</p> : room.groupSelection === "host" ? <p>Hostのグループ割り当てを待っています。</p> : <label className="field">所属グループ<select aria-label="所属グループ" value="" onChange={(e) => void choose(Number(e.target.value))}><option value="" disabled>選択してください</option>{Array.from({ length: room.groups ?? 1 }, (_, i) => <option key={i} value={i + 1}>グループ{i + 1}</option>)}</select></label>}
    </section> : <section className="box pad-lg stack"><h2>グループで話し合いましょう</h2>{room.participantView?.theme !== false && <p>テーマ：{room.theme}</p>}{room.participantView?.timer !== false && <p role="timer">残り時間 {clock.text}</p>}
      {canRecord && room.recording !== false && <><label><input type="checkbox" checked={recordingConsent} onChange={(e) => { setRecordingConsent(e.target.checked); if (!e.target.checked) void recording.discard(); }} />グループ全員が録音・声の照合・発言時間の集計に同意しました</label><p className="t-small">同意を取り消すと、ここまでの録音は送らずに削除します。</p><button className="btn btn--blue" disabled={!recordingConsent || ["asking", "recording", "stopped"].includes(recording.rec.state)} onClick={() => void recording.rec.start()}>{recording.rec.state === "recording" ? "録音中" : recording.rec.state === "stopped" ? "録音は停止済みです" : "録音を始める"}</button></>}
      {recorderState === "recording" && <button className="btn" onClick={() => void recording.rec.stop()}>録音を停止して端末に保管</button>}
      {!canRecord && room.recording !== false && <p>録音はHostが許可した別の端末が担当します。</p>}
      {speakerStatus && <p role="status">{speakerStatus}</p>}
      {recording.rec.saveError && <p role="alert">{recording.rec.saveError}</p>}
    </section>}
    {group && room.participantView?.speaking === true && (!ended || room.resultsPublished) && <GuestSpeaking roomId={roomId} group={group} />}
  </div></main>;
}
