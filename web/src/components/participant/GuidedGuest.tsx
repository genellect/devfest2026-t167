"use client";
import { AppShell, Stepper } from "@/components/shell";
import { SpeakerCapture } from "@/lib/speaker-capture";
import { useEffect, useRef, useState } from "react";
import { callApi } from "@/lib/api";
import { authenticatedFetch } from "@/lib/session";
import { useDoc, useCountdown, useInsights, millis, isRecordingLive, type Room, type GroupConfig, type GroupResult } from "@/lib/room";
import { DiscussionClock } from "@/components/DiscussionClock";
import { ConsensusStep, DiscussionNotes, OpinionStep, ResultStep } from "./steps";
import type { useGroupRecording } from "@/lib/recording";
import { registerRecordingGuard } from "@/lib/recording-recovery";
interface Own { voiceSource?: "mock" | "model"; displayName?: string; deviceMode?: "personal" | "shared"; ready?: boolean; attendees?: { id: string; displayName: string; voiceRegistered: boolean }[] }
export function GuidedGuest({ roomId, room, uid, group, recording, canRecord, recorder }: { roomId: string; room: Room; uid: string; group?: number; recording: ReturnType<typeof useGroupRecording>; canRecord: boolean; recorder?: { mine: boolean; name?: string } & Pick<GroupConfig, "recordingActive" | "recordingSeenAt"> }) {
  const own = useDoc<Own>(`sessions/${roomId}/members/${uid}`).data;
  // 合意の一文から出るグループの結果（終了後）と、教員が承認した問いかけ（議論中）
  const result = useDoc<GroupResult>(group ? `sessions/${roomId}/results/group-${group}` : undefined).data;
  const insights = useInsights(roomId, true, true);
  const status = group ? room.groupState?.[String(group)]?.status : undefined;
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
  // 録音する部屋では、声の登録は必須（登録していない人の声は、話者の推定でだれのものか分からないため。MVPフロー「初回だけ：音声登録」）。
  // 録音しない部屋・話者モデルがない環境では登録しない。途中から参加した人は、声を登録せずに議論へ進む（議論中の話者の推定の名簿を変えないため）
  const late = room.phase !== "collecting";
  const voiceRequired = room.recording !== false && !!own?.voiceSource;
  const voiced = !!own?.ready || late || !voiceRequired;
  const gs = group ? room.groupState?.[String(group)] : undefined;
  // 進み具合（Figma「最新」）：事前意見（表示名・声・意見）→ 議論 → 結論 → 結果
  const STEPS = ["事前意見", "議論", "結論", "結果"];
  const step = ended ? (result || status === "done" ? 3 : 2) : !named || !voiced || waiting ? 0 : 1;
  const shared = own?.deviceMode === "shared";
  // 教員が「全員に表示する」を押した問いかけ。届くまでは黄色にせず、1行の案内だけを置く
  const question = insights.length ? (
    <section className="sticky" aria-label="教員からの問いかけ">
      <p className="sticky__label">教員からの問いかけ</p>
      {insights.map((i) => <p key={i.id} className="sticky__text">{i.summary}</p>)}
    </section>
  ) : (
    <section className="prompt-empty" aria-label="教員からの問いかけ">
      <p className="t-small">まだ話されていない論点があると、教員がここに問いかけを表示します。</p>
    </section>
  );
  // 録音はグループで1台。担当が決まっていなければ、録音を始めた端末が担当になる（ほかの人には担当の名前が出る）
  const [claiming, setClaiming] = useState(false);
  async function startRecording() {
    setError("");
    if (!recorder?.mine) {
      setClaiming(true);
      try { await callApi(`/rooms/${roomId}/groups/recorder`, { take: true }); }
      catch (e) { setError((e as Error).message); return; }
      finally { setClaiming(false); }
    }
    await recording.rec.start();
  }
  async function releaseRecorder() {
    setError("");
    try { await callApi(`/rooms/${roomId}/groups/recorder`, { take: false }); }
    catch (e) { setError((e as Error).message); }
  }
  // 担当の端末は、いま録音しているかを送る。録音中は20秒ごとに送り直し、止まったら false を送る
  // （ほかの人の画面は、最後の送信から60秒以内だけ「録音中です」と出す）
  const mine = !!recorder?.mine, endedAt = millis(room.endedAt);
  // 送信は順番に行う（「止めた」が「録音中」より後に届いて、表示が逆にならないように）
  const beats = useRef(Promise.resolve());
  useEffect(() => {
    if (!mine || endedAt || recorderState === "asking") return;
    const active = recorderState === "recording";
    const send = () => { beats.current = beats.current.then(() => callApi(`/rooms/${roomId}/groups/recorder`, { take: true, active })).then(() => {}, () => { /* 次の送信でやり直す */ }); };
    send();
    if (!active) return;
    const t = setInterval(send, 20_000);
    return () => clearInterval(t);
  }, [mine, recorderState, endedAt, roomId]);
  // ほかの人の端末：担当の端末からの送信が途切れたら、60秒で「録音中」の表示を戻す
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (canRecord) return; const t = setInterval(() => setNow(Date.now()), 5_000); return () => clearInterval(t); }, [canRecord]);
  const othersRecording = !canRecord && isRecordingLive(recorder, now);
  // 止まった録音・画面を開き直す前の録音が端末にあれば、続きを録る（区間を増やす）
  const resumable = recorderState === "stopped" || recording.saved.count > 0;
  const leave = () => !recording.unsaved || window.confirm("録音がまだ送られていません。ホームに戻ると、録音は送られず分析されません。戻りますか？");
  const uploadState = recording.upload.state;
  const who = [own?.displayName, group && (room.groups ?? 1) > 1 ? `グループ${group}` : ""].filter(Boolean).join("・");
  return <AppShell eyebrow={who || undefined} title={room.participantView?.theme === false ? room.title : room.theme || room.title}
    steps={<Stepper steps={STEPS} current={step} />} back="/home" onLeave={leave}>
    <div className="flow">
      {error && <p className="notice notice--error" role="alert">{error}</p>}

      {ended ? <>
        <p className="notice" role="status">{room.endReason === "timeout" ? "設定した時間になりました。" : "教員が議論を終了しました。"}</p>
        {["uploading", "waiting", "done"].includes(uploadState) && <p className="notice" role="status">{uploadState === "done" ? "録音の送信・分析が完了しました。" : uploadState === "waiting" ? "グループの分析結果を待っています。録音は端末に保持しています。" : "録音を送信して分析しています。画面を閉じずにお待ちください。"}</p>}
        {uploadState === "failed" && <div className="notice notice--error stack"><p role="alert">{recording.upload.message}</p><button className="btn" onClick={() => void recording.retry()}>録音を再送する</button></div>}
        {!group ? <p className="notice">グループに入っていなかったため、結果はありません。</p>
          : !result && status !== "done" ? <ConsensusStep bare roomId={roomId} uid={uid} title={room.theme || room.title} submitted={gs?.submitted} total={gs?.total} />
          : !room.resultsPublished ? <p className="notice">結果は教員が公開すると表示されます。</p>
          : <ResultStep roomId={roomId} uid={uid} group={group} title={room.theme || room.title} result={result ?? null}
            showSpeaking={room.participantView?.speaking === true} />}
      </>

      : !named ? <form className="flow-card" onSubmit={saveNames}>
        <h2 className="flow-card__title">表示名を設定</h2>
        {late && <p className="flow-card__lead">議論はもう始まっています。表示名を決めると、そのまま話し合いに加われます。</p>}
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
        <p className="flow-card__lead">{shared ? "1人ずつ、次の文を9秒で読み上げてください。" : "次の文を9秒で読み上げてください。"}</p>
        <p className="read-aloud">私たちは、お互いの意見を聞き、理由を考えながら、よりよいアイデアを見つけます。</p>
        <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>声の特徴の登録と、上記の利用方法に同意します</span></label>
        <details><summary className="t-small">声の使い方</summary><p className="t-small">{shared ? "話し合いの発言時間の推定に使い、セッションの終了時に削除します。" : "この議論の発言時間の推定に使います。声の特徴だけを保存し、音声そのものは保存しません。議論ごとに登録し直します（その日・その場所の声で照合するため）。"}</p></details>
        {own!.attendees!.map((a) => <div className="stack stack--tight" key={a.id}>
          {own!.attendees!.length > 1 && <p className="t-label">{a.displayName}</p>}
          <button className="mic" data-done={a.voiceRegistered || undefined} disabled={!consent || !!registering || a.voiceRegistered} onClick={() => void enroll(a.id)}>
            {a.voiceRegistered ? "登録済み" : registering === a.id ? (registrationMode === "mic" ? "読み上げてください" : "音声を登録しています…") : "声を登録する"}
            {registering === a.id && registrationMode === "mic" && <span className="mic__meter" role="progressbar" aria-label={`${a.displayName}の音声登録の進捗`} aria-valuemin={0} aria-valuemax={9} aria-valuenow={registrationSeconds}><span style={{ width: `${(registrationSeconds / 9) * 100}%` }} /></span>}
          </button>
          <details><summary className="t-small">録音済みの音声から登録する</summary><p className="t-small">本人だけが話す8〜12秒、1MB以内の音声を選んでください。</p><input type="file" accept="audio/*" aria-label={`${a.displayName}の登録用音声ファイル`} disabled={!consent || !!registering || a.voiceRegistered} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void enroll(a.id, file); }} /></details>
        </div>)}
        {own!.voiceSource === "mock" && <p className="t-small">ローカルでは音声登録のモックを使います。実際の声の識別精度を表すものではありません。</p>}
      </section>

      : waiting ? (!group
        ? <p className="notice" role="status">グループの割り当てを待っています。</p>
        : <OpinionStep bare roomId={roomId} uid={uid} total={gs?.total} opinions={gs?.opinions} canChange={false} onChangeGroup={() => {}} />)

      : <>
        <section className="talk-hero" aria-labelledby="talk-title">
          <h2 id="talk-title" className="talk-hero__title">グループで話し合いましょう</h2>
          {room.participantView?.theme !== false && room.theme && <p className="talk-hero__theme">テーマ：{room.theme}</p>}
          {/* 時間は録音のカードの丸に出す。録音しない部屋では、ここに1行で出す（残り時間か経過時間を、つねに表示） */}
          {room.recording === false && <DiscussionClock room={room} variant="line" />}
        </section>
        {/* 教員が承認した問いかけ（まだ話されていない論点）は、届いたらメモより上に出す */}
        {insights.length > 0 && question}
        <DiscussionNotes bare roomId={roomId} />
        {canRecord && room.recording !== false && (
          <section className="flow-card record-card" aria-labelledby="record-title">
            <h2 id="record-title" className="t-sm">{recorder?.mine ? "録音（この端末が担当）" : "録音"}</h2>
            <DiscussionClock room={room} />
            {!recorder?.mine && <p className="t-small">録音はグループで1台です。この端末で録音すると、ほかの人の画面に、この端末が担当だと出ます。</p>}
            <label className="check"><input type="checkbox" checked={recordingConsent} onChange={(e) => { setRecordingConsent(e.target.checked); if (!e.target.checked) void recording.discard(); }} /><span>グループ全員が録音・声の照合・発言時間の集計に同意しました</span></label>
            <p className="t-small">録音はグループで1台です。同意を取り消すと、ここまでの録音は送らずに削除します。</p>
            <div className="home-actions">
              <button className="btn btn--blue" disabled={!recordingConsent || claiming || ["asking", "recording"].includes(recording.rec.state)} onClick={() => void startRecording()}>{recording.rec.state === "recording" ? "録音中" : resumable ? "録音を再開する" : "録音を始める"}</button>
              {recorderState === "recording" && <button className="btn" onClick={() => void recording.rec.stop()}>録音を停止して端末に保管</button>}
              {recorder?.mine && !recording.saved.count && ["idle", "denied", "unsupported"].includes(recorderState) && <button className="btn" onClick={() => void releaseRecorder()}>録音の担当をやめる</button>}
            </div>
            {/* 録音が止まっても、議論中は続きを録れる。止まるまでの録音は端末に残し、議論が終わったらまとめて送る */}
            {recorderState !== "recording" && recording.rec.interrupted && <p className="notice notice--error" role="alert">録音が止まりました（画面が消えた、別のアプリに切り替えたなど）。ここまでの録音はこの端末に残っています。「録音を再開する」を押して続けてください。</p>}
            {recorderState !== "recording" && !recording.rec.interrupted && recording.saved.count > 0 && <p className="t-small" role="status">この端末に、ここまでの録音が残っています。続けるときは「録音を再開する」を押してください。議論が終わると、まとめて送ります。</p>}
            {speakerStatus && <p className="t-small" role="status">{speakerStatus}</p>}
            {recording.rec.saveError && <p className="notice notice--error" role="alert">{recording.rec.saveError}</p>}
          </section>
        )}
        {/* Figma「最新」P3（他の人が録音中）345:44：誰の端末が録音しているかを、名前で出す（アプリフィードバック「誰が録音しているか分からない」）。
            赤い点と「録音中です」は、担当の端末がいま録音しているときだけ。担当が決まっただけ・止めたときは「担当しています」にする */}
        {!canRecord && room.recording !== false && (
          <section className="flow-card record-card" aria-labelledby="other-recording-title">
            <h2 className="t-sm">録音</h2>
            <DiscussionClock room={room} />
            <div className="other-recording" data-live={othersRecording || undefined}>
              <p id="other-recording-title" className="other-recording__title" aria-live="polite">
                {othersRecording && <span className="other-recording__dot" aria-hidden="true" />}
                {othersRecording ? `${recorder?.name ? `${recorder.name}さん` : "グループの別の端末"}が録音中です` : `${recorder?.name ? `${recorder.name}さんの端末` : "グループの別の端末"}が録音を担当しています`}
              </p>
              <p className="t-small">{othersRecording ? "録音はグループで1台です。この端末では録音しません。" : "いまは録音していません。"}録音の開始・停止と同意の取り消しは、担当の端末で行います。</p>
              <button type="button" className="btn" disabled>録音を始める</button>
            </div>
          </section>
        )}
        {insights.length === 0 && question}
      </>}

    </div>
  </AppShell>;
}

