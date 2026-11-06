"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, uploadRecording } from "./api";
import { useRecorder } from "./recorder";

/** 録音は30分まで（チームドキュメント F03）。超えたら止めて、そこまでを送る */
export const MAX_RECORDING_MS = 30 * 60_000;

/** none：送るものがない／uploading：送って分析を待っている／waiting：同じグループの別の送信の分析を待っている（録音は端末に残す） */
export type UploadState = "none" | "uploading" | "waiting" | "done" | "failed";
/** 部屋のドキュメントの groupState.{番号}.recording.status（API が書く） */
export type ServerRecordingStatus = "analyzing" | "done" | "failed" | undefined;

/**
 * グループの議論の録音と送信。議論の画面が閉じても録音を失わないよう、部屋の画面で1つだけ持つ。
 * - 議論が終わったら（どの端末で「終える」を押しても）、録音している端末が止めて送る
 * - 送信に失敗したら、端末に残した録音を送り直せる
 * - 別の送信を分析中（409）なら録音を残したまま、部屋の状態（serverStatus）が完了か失敗になるのを待つ
 * - 録音中にページを離れようとしたら、ブラウザに確かめさせる
 */
export function useGroupRecording(roomId: string, discussing: boolean, serverStatus: ServerRecordingStatus) {
  const rec = useRecorder();
  const { stop, state, elapsedMs } = rec;
  const [upload, setUpload] = useState<{ state: UploadState; message?: string }>({ state: "none" });
  const pending = useRef<{ blob: Blob; durationMs: number } | null>(null);
  const finishing = useRef(false);
  const inFlight = useRef(false);

  const retry = useCallback(async () => {
    const p = pending.current;
    if (!p || inFlight.current) return;
    inFlight.current = true;
    setUpload({ state: "uploading" });
    try {
      await uploadRecording(roomId, p.blob, p.durationMs / 1000);
      pending.current = null;
      setUpload({ state: "done" });
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      if (code === "already_analyzed") { pending.current = null; setUpload({ state: "done" }); }
      else if (code === "analysis_in_progress") setUpload({ state: "waiting", message: "グループの別の送信を分析しています。終わるまで、録音はこの端末に残します。" });
      else setUpload({ state: "failed", message: (e as Error).message });
    } finally { inFlight.current = false; }
  }, [roomId]);

  // 別の送信の分析が終わったら完了に、失敗したら送り直せるようにする
  useEffect(() => {
    if (upload.state !== "waiting") return;
    if (serverStatus === "done") { pending.current = null; setUpload({ state: "done" }); }
    else if (serverStatus === "failed") setUpload({ state: "failed", message: "グループの別の送信の分析に失敗しました。この端末の録音を送ってください。" });
  }, [serverStatus, upload.state]);

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
  // 録音中・未送信の録音があるときにページを離れると、録音が消える
  const unsaved = active || upload.state === "uploading" || upload.state === "failed" || upload.state === "waiting";
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  return { rec, upload, retry, unsaved };
}
