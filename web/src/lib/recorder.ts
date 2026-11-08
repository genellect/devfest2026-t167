"use client";
import { firebase } from "./firebase";
import { deleteRecovery, registerRecordingGuard, saveChunk, saveRecording, retainUnsavedAudio, releaseUnsavedAudio, type RecoveryRecording } from "./recording-recovery";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * グループの議論を端末のマイクで録音する。送信は useGroupRecording（lib/recording.ts）が行う。
 * 30分の録音が API の上限（12MB）に収まるよう、ビットレートを 32kbps にする（30分で約7MB）。
 */
export type RecorderState = "idle" | "asking" | "recording" | "paused" | "stopped" | "denied" | "unsupported";

export function useRecorder(roomId?: string) {
  const [state, setState] = useState<RecorderState>("idle");
  const [saveError, setSaveError] = useState<string>();
  const manifest = useRef<RecoveryRecording | null>(null);
  const saving = useRef(Promise.resolve());
  const savedFailure = useRef(false);
  const stopped = useRef<{ blob: Blob; durationMs: number } | null>(null);
  const stopping = useRef<Promise<{ blob: Blob; durationMs: number } | null> | null>(null);
  const stopRef = useRef<() => Promise<unknown>>(() => Promise.resolve());
  const finalizeRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const [level, setLevel] = useState(0); // 0〜1 の音量。円形の音の表示に使う
  const [elapsedMs, setElapsedMs] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const raf = useRef<number>(0);
  const clock = useRef({ startedAt: 0, carried: 0, running: false });

  const cleanup = useCallback(() => {
    cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((t) => { t.onended = null; t.stop(); });
    audio.current?.close().catch(() => {});
    stream.current = null; audio.current = null;
  }, []);
  useEffect(() => cleanup, [cleanup]);

  // 経過時間（一時停止中は止める）
  useEffect(() => {
    if (state !== "recording") return;
    const t = setInterval(() => setElapsedMs(clock.current.carried + Date.now() - clock.current.startedAt), 500);
    return () => clearInterval(t);
  }, [state]);

  const start = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setState("unsupported"); return;
    }
    setState("asking");
    try {
      setSaveError(undefined); savedFailure.current = false; stopped.current = null;
      const uid = firebase().auth.currentUser?.uid;
      if (!uid) throw new Error("録音にはログインが必要です");
      const capacity = await navigator.storage?.estimate?.();
      if (capacity?.quota && capacity.usage !== undefined && capacity.quota - capacity.usage < 15 * 1024 * 1024) throw new Error("保存容量が不足しています");
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      stream.current = s;
      const r = new MediaRecorder(s, { audioBitsPerSecond: 32_000 });
      chunks.current = [];
      manifest.current = { id: crypto.randomUUID(), uid, roomId, createdAt: Date.now(), mimeType: r.mimeType || "audio/webm", complete: false, chunks: 0 };
      await saveRecording(manifest.current);
      saving.current = Promise.resolve();
      r.ondataavailable = (e) => {
        if (!e.data.size) return;
        const sequence = chunks.current.length;
        chunks.current.push(e.data);
        const m = { ...manifest.current!, chunks: chunks.current.length };
        manifest.current = m;
        saving.current = saving.current.then(async () => { await saveChunk(m.id, sequence, e.data); await saveRecording(m); }).catch(() => {
          savedFailure.current = true;
          setSaveError("端末の保存容量を確認してください。録音を停止して、この画面に保持しています。");
          void stopRef.current();
        });
      };
      rec.current = r;
      // ブラウザによる許可取り消しなど、外部要因の停止でも最終チャンクを保存する。
      let resolveCompletion: () => void;
      const completed = new Promise<void>((resolve) => { resolveCompletion = resolve; });
      r.onstop = () => { resolveCompletion(); void stopRef.current(); };
      finalizeRef.current = async () => { await completed; };
      s.getTracks().forEach((track) => { track.onended = () => { void stopRef.current(); }; });
      r.start(15_000);
      // 音量を測って、円の大きさに反映する
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(s).connect(analyser);
      audio.current = ctx;
      const buf = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
        raf.current = requestAnimationFrame(tick);
      };
      tick();
      clock.current = { startedAt: Date.now(), carried: 0, running: true };
      setElapsedMs(0);
      setState("recording");
    } catch (e) {
      cleanup();
      setSaveError(e instanceof Error ? e.message : "録音を開始できません");
      setState((e as DOMException)?.name === "NotAllowedError" ? "denied" : "unsupported");
    }
  }, [cleanup, roomId]);

  const pause = useCallback(() => {
    if (rec.current?.state !== "recording") return;
    rec.current.pause();
    clock.current.carried += Date.now() - clock.current.startedAt;
    clock.current.running = false;
    setElapsedMs(clock.current.carried);
    setLevel(0);
    setState("paused");
  }, []);

  const resume = useCallback(() => {
    if (rec.current?.state !== "paused") return;
    rec.current.resume();
    clock.current.startedAt = Date.now();
    clock.current.running = true;
    setState("recording");
  }, []);

  /** 録音を終える。録った音声と、一時停止を除いた長さを返す */
  const stop = useCallback(async (): Promise<{ blob: Blob; durationMs: number } | null> => {
    if (stopping.current) return stopping.current;
    const r = rec.current;
    if (!r || stopped.current) return stopped.current;
    const task = (async () => {
      const durationMs = clock.current.carried + (clock.current.running ? Date.now() - clock.current.startedAt : 0);
      clock.current.running = false;
      if (r.state !== "inactive") r.stop();
      await finalizeRef.current();
      cleanup(); setLevel(0); setState("stopped");
      const result = { blob: new Blob(chunks.current, { type: r.mimeType || "audio/webm" }), durationMs };
      stopped.current = result;
      if (manifest.current) {
        const m = { ...manifest.current, complete: true, chunks: chunks.current.length, durationMs };
        // IndexedDBの失敗時もモジュール内メモリに保持し、再認証後にダウンロードできる。
        retainUnsavedAudio(m, result.blob);
        await saving.current;
        if (!savedFailure.current) {
          try { await saveRecording(m); releaseUnsavedAudio(m.id); }
          catch { savedFailure.current = true; setSaveError("端末内の保存に失敗しました。画面を閉じずに音声をダウンロードしてください。"); }
        }
      }
      return result;
    })();
    stopping.current = task;
    try { return await task; } finally { stopping.current = null; }
  }, [cleanup]);
  stopRef.current = stop;
  /** 分析完了の確認後に、復旧用DBとメモリの音声を消す。失敗は呼び出し元へ伝えて再試行できるようにする。 */
  const clearCompleted = useCallback(async () => {
    await stop();
    await saving.current;
    const m = manifest.current;
    if (m) await deleteRecovery(m.uid, m.id);
    stopped.current = null; manifest.current = null; chunks.current = []; rec.current = null;
    setSaveError(undefined);
  }, [stop]);
  /** 利用者の操作で録音を捨てる。送らず、端末に残した復旧用の録音も消す */
  const discard = useCallback(async () => {
    const m = manifest.current;
    await stop();
    stopped.current = null; manifest.current = null; chunks.current = [];
    if (m) { releaseUnsavedAudio(m.id); await deleteRecovery(m.uid, m.id).catch(() => {}); }
    setElapsedMs(0); setState("idle");
  }, [stop]);
  useEffect(() => registerRecordingGuard(async () => { await stop(); }), [stop]);

  const capture = useCallback(() => ({ stream: stream.current, context: audio.current }), []);
  return { state, saveError, level, elapsedMs, start, pause, resume, stop, discard, clearCompleted, capture };
}

export const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
