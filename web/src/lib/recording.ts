"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, uploadRecording } from "./api";
import { useRecorder } from "./recorder";

/** 録音は30分まで（チームドキュメント F03）。超えたら止めて、そこまでを送る */
export const MAX_RECORDING_MS = 30 * 60_000;

export type UploadState = "none" | "uploading" | "done" | "failed";

/**
 * グループの議論の録音と送信。議論の画面が閉じても録音を失わないよう、部屋の画面で1つだけ持つ。
 * - 議論が終わったら（どの端末で「終える」を押しても）、録音している端末が止めて送る
 * - 送信に失敗したら、端末に残した録音を送り直せる。別の端末の録音がすでに分析済みなら、送らずに終える
 */
export function useGroupRecording(roomId: string, discussing: boolean) {
  const rec = useRecorder();
  const { stop, state, elapsedMs } = rec;
  const [upload, setUpload] = useState<{ state: UploadState; message?: string }>({ state: "none" });
  const pending = useRef<{ blob: Blob; durationMs: number } | null>(null);
  const finishing = useRef(false);

  const retry = useCallback(async () => {
    const p = pending.current;
    if (!p) return;
    setUpload({ state: "uploading" });
    try {
      await uploadRecording(roomId, p.blob, p.durationMs / 1000);
      pending.current = null;
      setUpload({ state: "done" });
    } catch (e) {
      if (e instanceof ApiError && (e.code === "already_analyzed" || e.code === "analysis_in_progress")) {
        pending.current = null;
        setUpload({ state: "done", message: "グループのほかの端末の録音を分析しています。" });
        return;
      }
      setUpload({ state: "failed", message: (e as Error).message });
    }
  }, [roomId]);

  const finish = useCallback(async () => {
    if (finishing.current) return;
    finishing.current = true;
    try {
      const r = await stop();
      if (r) { pending.current = r; await retry(); }
    } finally { finishing.current = false; }
  }, [stop, retry]);

  const active = state === "recording" || state === "paused";
  useEffect(() => { if (!discussing && active) void finish(); }, [discussing, active, finish]);
  useEffect(() => { if (state === "recording" && elapsedMs >= MAX_RECORDING_MS) void finish(); }, [state, elapsedMs, finish]);

  return { rec, upload, retry };
}
