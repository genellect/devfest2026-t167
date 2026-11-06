"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * グループの議論を端末のマイクで録音する。送信は useGroupRecording（lib/recording.ts）が行う。
 * 30分の録音が API の上限（12MB）に収まるよう、ビットレートを 32kbps にする（30分で約7MB）。
 */
export type RecorderState = "idle" | "asking" | "recording" | "paused" | "stopped" | "denied" | "unsupported";

export function useRecorder() {
  const [state, setState] = useState<RecorderState>("idle");
  const [level, setLevel] = useState(0); // 0〜1 の音量。円形の音の表示に使う
  const [elapsedMs, setElapsedMs] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const raf = useRef<number>(0);
  const clock = useRef({ startedAt: 0, carried: 0 });

  const cleanup = useCallback(() => {
    cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((t) => t.stop());
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
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      stream.current = s;
      const r = new MediaRecorder(s, { audioBitsPerSecond: 32_000 });
      chunks.current = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      r.start(1000);
      rec.current = r;
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
      clock.current = { startedAt: Date.now(), carried: 0 };
      setElapsedMs(0);
      setState("recording");
    } catch (e) {
      cleanup();
      setState((e as DOMException)?.name === "NotAllowedError" ? "denied" : "unsupported");
    }
  }, [cleanup]);

  const pause = useCallback(() => {
    if (rec.current?.state !== "recording") return;
    rec.current.pause();
    clock.current.carried += Date.now() - clock.current.startedAt;
    setElapsedMs(clock.current.carried);
    setLevel(0);
    setState("paused");
  }, []);

  const resume = useCallback(() => {
    if (rec.current?.state !== "paused") return;
    rec.current.resume();
    clock.current.startedAt = Date.now();
    setState("recording");
  }, []);

  /** 録音を終える。録った音声と、一時停止を除いた長さを返す */
  const stop = useCallback(async (): Promise<{ blob: Blob; durationMs: number } | null> => {
    const r = rec.current;
    if (!r || r.state === "inactive") return null;
    const durationMs = clock.current.carried + (r.state === "recording" ? Date.now() - clock.current.startedAt : 0);
    const done = new Promise<void>((ok) => { r.onstop = () => ok(); });
    r.stop();
    await done;
    cleanup();
    setLevel(0);
    setState("stopped");
    return { blob: new Blob(chunks.current, { type: r.mimeType || "audio/webm" }), durationMs };
  }, [cleanup]);

  return { state, level, elapsedMs, start, pause, resume, stop };
}

export const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
