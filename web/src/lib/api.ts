"use client";
import { workspaceToken } from "./workspace";
import { ensureSignedIn } from "./firebase";
import { authenticatedFetch } from "./session";

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly retryAfterSec?: number, readonly requestId?: string) { super(message); }
}

async function send<T>(path: string, contentType: string, body: BodyInit, timeoutMs = 30_000): Promise<T> {
  const user = await ensureSignedIn();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let classroomToken: string | undefined;
    if (path === "/rooms/join") { try { classroomToken = workspaceToken(); } catch { /* 未連携の通常コード参加は維持する。 */ } }
    const res = await authenticatedFetch(path, { method: "POST", headers: { "content-type": contentType, ...(classroomToken ? { "x-google-access-token": classroomToken } : {}) }, body, signal: controller.signal }, user);
    const requestId = res.headers.get("x-request-id") ?? undefined;
    const data = await res.json().catch(() => undefined);
    if (!res.ok) {
      const seconds = Number(data?.error?.retryAfterSec ?? res.headers.get("retry-after"));
      throw new ApiError(res.status, data?.error?.code ?? "upstream_error", data?.error?.message ?? "サーバーに接続できませんでした。少し待ってから再度お試しください", Number.isFinite(seconds) && seconds > 0 ? seconds : undefined, requestId);
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new ApiError(502, "invalid_response", "サーバーの応答を確認できませんでした", undefined, requestId);
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const authCode = (error as { code?: string })?.code;
    if (authCode && ['auth/user-token-expired', 'auth/user-disabled', 'auth/invalid-user-token'].includes(authCode)) {
      throw new ApiError(401, 'login_required', 'ログインの有効期限が切れました。Googleでログインし直してください');
    }
    if (controller.signal.aborted) throw new ApiError(408, "request_timeout", "処理に時間がかかっています。状態を確認してから再送してください");
    throw new ApiError(0, "network_unavailable", "通信できませんでした。接続を確認して、もう一度お試しください");
  } finally { clearTimeout(timer); }
}

/** 同じオリジンの /api を ID トークン付きで呼ぶ。通信失敗や5xxを自動再送しない。 */
export const callApi = <T>(path: string, body: object = {}) => send<T>(path, "application/json", JSON.stringify(body));

/** 音声は同じBlobを保持して再送する。受領済みかはAPIの指紋・受領結果で確認する。 */
export const uploadRecording = (roomId: string, audio: Blob, durationSec: number) =>
  send<{ group: number; status: "done"; speechDetected: boolean; totalMinutes: number }>(
    `/rooms/${roomId}/groups/recording?durationSec=${Math.max(1, Math.round(durationSec))}`,
    audio.type || "audio/webm", audio, 210_000,
  );
