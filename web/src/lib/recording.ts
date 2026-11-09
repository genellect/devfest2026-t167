"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, uploadRecording } from "./api";
import { firebase } from "./firebase";
import { expireRoomRecordings } from "./recording-recovery";
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
export function useGroupRecording(roomId: string, discussing: boolean, serverStatus: ServerRecordingStatus, endedAt?: number) {
  const rec = useRecorder(roomId);
  const { stop, state, elapsedMs, discard: discardRecorder, clearCompleted } = rec;
  const [upload, setUpload] = useState<{ state: UploadState; message?: string }>({ state: "none" });
  const pending = useRef<{ blob: Blob; durationMs: number } | null>(null);
  const finishing = useRef(false);
  const discarding = useRef(false);
  const inFlight = useRef(false);
  // 通信の途切れ・混雑など一時的な失敗は、自動で3回まで送り直す（API の「失敗から30秒あける」の指示があればそれに従う）
  const transient = useRef(false), autoAttempts = useRef(0), waitMs = useRef(0);

  const complete = useCallback(async () => {
    await clearCompleted();
    pending.current = null;
    setUpload({ state: "done" });
  }, [clearCompleted]);

  const retry = useCallback(async () => {
    const p = pending.current;
    if (!p || inFlight.current) return;
    inFlight.current = true;
    transient.current = false;
    setUpload({ state: "uploading" });
    try {
      await uploadRecording(roomId, p.blob, p.durationMs / 1000);
      await complete();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      if (code === "already_analyzed") {
        try { await complete(); }
        catch (cleanupError) { setUpload({ state: "failed", message: (cleanupError as Error).message }); }
      }
      else if (code === "analysis_in_progress") setUpload({ state: "waiting", message: "グループの別の送信を分析しています。終わるまで、録音はこの端末に残します。" });
      else {
        transient.current = e instanceof ApiError && [0, 408, 429, 503].includes(e.status);
        waitMs.current = e instanceof ApiError && e.retryAfterSec ? e.retryAfterSec * 1000 : 0;
        setUpload({ state: "failed", message: (e as Error).message });
      }
    } finally { inFlight.current = false; }
  }, [roomId, complete]);

  useEffect(() => {
    if (upload.state !== "failed" || !transient.current || autoAttempts.current >= 3) return;
    const resume = () => {
      if (autoAttempts.current >= 3 || (endedAt && Date.now() >= endedAt + 5 * 60_000)) return;
      autoAttempts.current++; void retry();
    };
    const timer = setTimeout(resume, Math.max(5000 * (autoAttempts.current + 1), waitMs.current));
    window.addEventListener("online", resume, { once: true });
    return () => { clearTimeout(timer); window.removeEventListener("online", resume); };
  }, [upload.state, retry, endedAt]);

  // 別の送信の分析が終わったら完了に、失敗したら送り直せるようにする
  useEffect(() => {
    if (upload.state !== "waiting") return;
    if (serverStatus === "done") {
      void complete().catch((error: Error) => setUpload({ state: "failed", message: error.message }));
    }
    else if (serverStatus === "failed") setUpload({ state: "failed", message: "グループの別の送信の分析に失敗しました。この端末の録音を送ってください。" });
  }, [serverStatus, upload.state, complete]);

  const finish = useCallback(async () => {
    if (finishing.current || discarding.current) return;
    finishing.current = true;
    try {
      const r = await stop();
      if (r) { pending.current = r; await retry(); }
    } finally { finishing.current = false; }
  }, [stop, retry]);

  /** 利用者が「録音を破棄」を選んだら、送らずに捨てる（議論の終了と重なっても送信しない） */
  const discard = useCallback(async () => {
    discarding.current = true; autoAttempts.current = 0; transient.current = false;
    try { pending.current = null; await discardRecorder(); setUpload({ state: "none" }); }
    finally { discarding.current = false; }
  }, [discardRecorder]);

  useEffect(() => {
    if (!endedAt) return;
    const deadline = endedAt + 5 * 60_000, uid = firebase().auth.currentUser?.uid;
    if (uid) void expireRoomRecordings(uid, roomId, deadline).catch(() => {});
    const timer = setTimeout(() => { pending.current = null; void discard(); }, Math.max(0, deadline - Date.now()));
    return () => clearTimeout(timer);
  }, [endedAt, roomId, discard]);

  const active = state === "recording" || state === "paused";
  useEffect(() => { if (!discussing && (active || (state === "stopped" && upload.state === "none"))) void finish(); }, [discussing, active, state, upload.state, finish]);
  useEffect(() => { if (state === "recording" && elapsedMs >= MAX_RECORDING_MS) void finish(); }, [state, elapsedMs, finish]);
  // 録音中・未送信の録音があるときにページを離れると、録音が消える
  const unsaved = active || upload.state === "uploading" || upload.state === "failed" || upload.state === "waiting";
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  return { rec, upload, retry, discard, unsaved };
}
