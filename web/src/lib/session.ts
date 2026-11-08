"use client";
import { useSyncExternalStore } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { firebase } from "./firebase";
import { preserveRecordings } from "./recording-recovery";

export interface SessionView {
  sessionId: string; deviceLabel: string; deviceType: string; createdAt: number; lastActivityAt: number;
  expiresAt: number; revokedAt: number | null; revokeReason: string | null; isSharedDevice: boolean;
  lockedAt: number | null; classEndsAt: number | null;
}
export interface PolicyView { idleDays: number; maxConcurrentSessions: number; sharedIdleMinutes: number; endAtClassEnd: boolean; newDeviceNotifications: boolean }
export interface SessionReply { session: SessionView; policy: PolicyView; serverNow: number }
export type SessionStatus = "loading" | "active" | "locked" | "saving" | "signed-out" | "offline";
export interface SessionState { status: SessionStatus; user: User | null | undefined; session?: SessionView; policy?: PolicyView; reason?: string; message?: string }
export const LOGOUT_MESSAGES: Record<string, string> = {
  idle_expired: "7日間利用がなかったため、ログアウトしました。",
  replaced: "別の端末からログインされたため、この端末のセッションを終了しました。",
  class_ended: "授業が終了したため、この端末のセッションを終了しました。",
  admin_revoked: "学校のセキュリティ設定により、再認証が必要です。",
  logout_all: "すべての端末からログアウトしました。",
  session_locked: "学校のセキュリティ設定により、再認証が必要です。",
};
const initial: SessionState = { status: "loading", user: undefined };
let generation = 0;
let state = initial, started = false, signingIn = false, invalidating = false;
const listeners = new Set<() => void>();
function publish(value: SessionState) { state = value; listeners.forEach((fn) => fn()); }
export const sessionSnapshot = () => state;
export class SessionRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly reason?: string, readonly retryAfterSec?: number, readonly requestId?: string) { super(message); }
}
export async function authenticatedFetch(path: string, init: RequestInit = {}, user?: User, handleFailure = true): Promise<Response> {
  const auth = firebase().auth;
  await auth.authStateReady();
  const current = user ?? auth.currentUser;
  if (!current) throw new SessionRequestError(401, "session_required", "Googleでログインしてください");
  const attempt = async (refresh = false) => fetch(`/api${path}`, { ...init, credentials: "same-origin", headers: { ...Object.fromEntries(new Headers(init.headers)), authorization: `Bearer ${await current.getIdToken(refresh)}` } });
  let response: Response;
  try {
    response = await attempt();
    if (response.status === 401) {
    const body = await response.clone().json().catch(() => null);
    // Firebaseトークン自体が無効なときだけ更新。独自セッションを作り直して失効を回避しない。
      if (body?.error?.code === "unauthenticated") response = await attempt(true);
    }
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code && ["auth/user-token-expired", "auth/user-disabled", "auth/invalid-user-token", "auth/user-not-found"].includes(code)) {
      if (handleFailure) void handleSessionFailure("session_required");
      throw new SessionRequestError(401, "session_required", "Googleでログインし直してください");
    }
    throw error;
  }
  if (!response.ok && handleFailure && (response.status === 401 || response.status === 423)) {
    const body = await response.clone().json().catch(() => null);
    void handleSessionFailure(body?.error?.code ?? "session_required", body?.error?.reason);
  }
  return response;
}
export async function sessionRequest<T>(path: string, method = "GET", body?: object, user?: User, handleFailure = true): Promise<T> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await authenticatedFetch(path, { method, headers: body ? { "content-type": "application/json" } : {}, ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal }, user, handleFailure);
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new SessionRequestError(response.status, data?.error?.code ?? "upstream_error", data?.error?.message ?? "接続を確認して、もう一度お試しください", data?.error?.reason);
    return data as T;
  } finally { clearTimeout(timer); }
}
function accept(user: User, data: SessionReply) { if (firebase().auth.currentUser?.uid !== user.uid) return; publish({ status: "active", user, session: data.session, policy: data.policy }); }
export async function restoreSession() {
  if (signingIn || invalidating) return;
  const version = generation;
  const user = firebase().auth.currentUser;
  if (!user?.providerData.some((p) => p.providerId === "google.com")) { publish({ status: "signed-out", user: null, reason: state.reason }); return; }
  try { const data = await sessionRequest<SessionReply>("/sessions/current", "GET", undefined, user); if (!signingIn && !invalidating && generation === version) accept(user, data); }
  catch (e) {
    if (e instanceof SessionRequestError && [401, 423].includes(e.status)) return;
    if (state.status !== "active" && state.status !== "locked" && state.status !== "saving") publish({ status: "offline", user: undefined, message: "接続できません。録音は端末に残し、接続の回復後に再確認します。" });
  }
}
export function logoutMessage(reason: string, days = 7) {
  return reason === "idle_expired" ? `${days}日間利用がなかったため、ログアウトしました。` : LOGOUT_MESSAGES[reason] ?? "Googleでログインし直してください。";
}
export async function handleSessionFailure(code: string, reason?: string) {
  if (signingIn || invalidating || code === "reauth_required") return;
  invalidating = true; generation++;
  const user = firebase().auth.currentUser;
  const lock = code === "session_locked";
  publish({ ...state, user: user ?? state.user, status: "saving", reason: lock ? code : reason ?? code });
  try { await preserveRecordings(); }
  catch { publish({ ...state, message: "音声の保存に問題があります。この画面を閉じず、再認証後に録音を保存してください。" }); }
  if (lock) publish({ ...state, user, status: "locked", reason: code });
  else { await signOut(firebase().auth).catch(() => {}); publish({ status: "signed-out", user: null, reason: reason ?? code, policy: state.policy, message: state.message }); }
  invalidating = false;
}
export function beginSignIn() { signingIn = true; generation++; }
export function endSignIn() { signingIn = false; }
export async function establishSession(info: { isSharedDevice: boolean; classEndsAt: number | null }) {
  const user = firebase().auth.currentUser;
  if (!user) throw new Error("Googleでログインしてください");
  const type = window.matchMedia("(pointer: coarse)").matches ? (Math.min(innerWidth, innerHeight) > 600 ? "tablet" : "phone") : "pc";
  const data = await sessionRequest<SessionReply>("/sessions", "POST", { ...info, deviceType: type, deviceLabel: type === "tablet" ? "タブレットのブラウザ" : type === "phone" ? "スマートフォンのブラウザ" : "PCのブラウザ" }, user, false);
  // HttpOnly CookieはJSから読めない。作成成功だけで入室せず、ブラウザがCookieを返せることをAPIで確認する。
  let checked: SessionReply;
  try { checked = await sessionRequest<SessionReply>("/sessions/current", "GET", undefined, user, false); }
  catch (error) {
    if (error instanceof SessionRequestError && error.code === "session_required") throw new SessionRequestError(401, "cookie_unavailable", "ログインに必要なCookieを確認できません");
    throw error;
  }
  if (checked.session.sessionId !== data.session.sessionId) throw new SessionRequestError(401, "cookie_unavailable", "ログイン状態を確認できません");
  accept(user, checked);
}
export async function unlockSession(reauthenticate: () => Promise<unknown>) {
  signingIn = true;
  try { await reauthenticate(); const user = firebase().auth.currentUser!; accept(user, await sessionRequest<SessionReply>("/sessions/unlock", "POST", {}, user, false)); }
  finally { signingIn = false; }
}
export async function logoutSession(all = false) {
  generation++;
  await preserveRecordings();
  // 通信失敗時はサーバー失効を成功とせず、その場に留めて再試行させる。
  await sessionRequest(all ? "/sessions/logout-all" : "/sessions/logout", "POST", {}, undefined, false);
  await signOut(firebase().auth);
  publish({ status: "signed-out", user: null, reason: all ? "logout_all" : "logout" });
}
export async function recordActivity() {
  if (state.status !== "active" || !state.user) return;
  try {
    const user = state.user, id = state.session?.sessionId;
    const data = await sessionRequest<SessionReply>("/sessions/activity", "POST", {});
    if (!invalidating && state.status === "active" && state.session?.sessionId === id) accept(user, data);
  }
  catch { /* 通信障害では期限を延長したと仮定しない。再接続後に検査する。 */ }
}
function start() {
  if (started || typeof window === "undefined") return; started = true;
  onAuthStateChanged(firebase().auth, () => { if (!signingIn && !invalidating) void restoreSession(); });
  window.setInterval(() => { if (!document.hidden && state.status === "active") void restoreSession(); }, 30_000);
  window.addEventListener("online", () => void restoreSession());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void restoreSession(); });
}
export function useAppSession() {
  return useSyncExternalStore((fn) => { listeners.add(fn); start(); return () => listeners.delete(fn); }, sessionSnapshot, () => initial);
}
