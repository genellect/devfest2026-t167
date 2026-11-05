"use client";
import { ensureSignedIn } from "./firebase";

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly retryAfterSec?: number) { super(message); }
}

/** 同じオリジンの /api を ID トークン付きで呼ぶ */
export async function callApi<T>(path: string, body: object = {}): Promise<T> {
  const user = await ensureSignedIn();
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${await user.getIdToken()}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? "unknown", data?.error?.message ?? "エラーが起きました", data?.error?.retryAfterSec);
  return data as T;
}
