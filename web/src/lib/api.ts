"use client";
import { ensureSignedIn } from "./firebase";

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly retryAfterSec?: number) { super(message); }
}

async function send<T>(path: string, contentType: string, body: BodyInit): Promise<T> {
  const user = await ensureSignedIn();
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "content-type": contentType, authorization: `Bearer ${await user.getIdToken()}` },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? "unknown", data?.error?.message ?? "エラーが起きました", data?.error?.retryAfterSec);
  return data as T;
}

/** 同じオリジンの /api を ID トークン付きで呼ぶ */
export const callApi = <T>(path: string, body: object = {}) => send<T>(path, "application/json", JSON.stringify(body));

/** グループの議論の録音を送り、分析を待つ。グループ全員の同意を画面で確かめてから呼ぶ */
export const uploadRecording = (roomId: string, audio: Blob, durationSec: number) =>
  send<{ group: number; status: "done"; speechDetected: boolean; totalMinutes: number }>(
    `/rooms/${roomId}/groups/recording?consent=1&durationSec=${Math.max(1, Math.round(durationSec))}`,
    audio.type || "audio/webm",
    audio,
  );
