"use client";
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
    const res = await authenticatedFetch(path, { method: "POST", headers: { "content-type": contentType }, body, signal: controller.signal }, user);
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

/**
 * 音声は同じBlobを保持して再送する。受領済みかはAPIの指紋・受領結果で確認する。
 * 録音が途中で止まって続きを録ったときは、区間（それぞれ別の録音ファイル）を順につなげて送り、parts に各区間のバイト数を付ける。
 */
export const uploadRecording = (roomId: string, audio: Blob | Blob[], durationSec: number) => {
  const parts = Array.isArray(audio) ? audio : [audio];
  const body = parts.length === 1 ? parts[0] : new Blob(parts, { type: parts[0].type });
  const query = `consent=1&durationSec=${Math.min(MAX_UPLOAD_SEC, Math.max(1, Math.round(durationSec)))}${parts.length > 1 ? `&parts=${parts.map((p) => p.size).join(",")}` : ""}`;
  return send<{ group: number; status: "done"; speechDetected: boolean; totalMinutes: number }>(
    `/rooms/${roomId}/groups/recording?${query}`, parts[0].type || "audio/webm", body, 210_000,
  );
};
/** API が受け付ける録音の長さの上限（31分）。区間の長さは端末の見積もりなので、上限を超えて送らない */
const MAX_UPLOAD_SEC = 31 * 60;
