"use client";
import { browserPopupRedirectResolver, GoogleAuthProvider, reauthenticateWithPopup, onAuthStateChanged } from "firebase/auth";
import { firebase } from "./firebase";
import { authenticatedFetch, sessionSnapshot } from "./session";
import { googleLoginError } from "./hostAuth";

export interface Course { id: string; name: string; section?: string; role: "teacher" | "student" }
export const SCOPES = {
  classroom: ["https://www.googleapis.com/auth/classroom.courses.readonly"],
  roster: ["https://www.googleapis.com/auth/classroom.courses.readonly", "https://www.googleapis.com/auth/classroom.rosters.readonly"],
};
let cached: { uid: string; token: string; scopes: string[]; expires: number } | undefined;
let watching = false;
function watch() {
  if (watching) return; watching = true;
  onAuthStateChanged(firebase().auth, user => { if (cached?.uid !== user?.uid) cached = undefined; });
}
/** Googleのアクセストークンは永続化せず、このタブのメモリだけに保持する。 */
export async function authorizeWorkspace(scopes: readonly string[]) {
  const user = firebase().auth.currentUser; watch();
  if (!user) throw new Error("Googleでログインしてください");
  if (process.env.NEXT_PUBLIC_USE_EMULATORS === "1" && process.env.NEXT_PUBLIC_CLASSROOM_MOCK === "1" && scopes.every(scope => scope.startsWith("https://www.googleapis.com/auth/classroom."))) {
    const sub = user.providerData.find(p => p.providerId === "google.com")?.uid;
    if (!sub) throw new Error("Googleでログインしてください");
    cached = { uid: user.uid, token: `classroom-mock:${sub}`, scopes: [...scopes], expires: Date.now() + 50 * 60_000 };
    return cached.token;
  }
  if (process.env.NEXT_PUBLIC_USE_EMULATORS === "1") throw new Error("Google連携は実Googleログインの環境で利用できます。通常のセッション作成・参加はこのまま使えます。");
  if (cached?.uid === user.uid && cached.expires > Date.now() && scopes.every(scope => cached!.scopes.includes(scope))) return cached.token;
  const provider = new GoogleAuthProvider(); scopes.forEach(scope => provider.addScope(scope));
  provider.setCustomParameters({ login_hint: user.email ?? "", prompt: "consent", include_granted_scopes: "true" });
  try {
    const result = await reauthenticateWithPopup(user, provider, browserPopupRedirectResolver);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken || firebase().auth.currentUser?.uid !== user.uid) throw new Error("no_credential");
    cached = { uid: user.uid, token: credential.accessToken, scopes: [...scopes], expires: Date.now() + 50 * 60_000 };
    return cached.token;
  } catch (error) { throw new Error(googleLoginError(error)); }
}
export function forgetWorkspace() { cached = undefined; }
export function workspaceToken() {
  const status = sessionSnapshot().status;
  if (status !== "active") { cached = undefined; throw new Error("ログイン状態を確認してください"); }
  if (!cached || cached.uid !== firebase().auth.currentUser?.uid || cached.expires <= Date.now()) { cached = undefined; throw new Error("Classroomとの連携をやり直してください"); }
  return cached.token;
}
export async function workspaceRequest<T>(path: string, options: { token?: string; body?: object; signal?: AbortSignal } = {}): Promise<T> {
  const current = firebase().auth.currentUser;
  if (!current) throw new Error("Googleでログインしてください");
  const res = await authenticatedFetch(path, { method: options.body ? "POST" : "GET", signal: options.signal ?? AbortSignal.timeout(90_000), headers: { ...(options.token ? { "x-google-access-token": options.token } : {}), ...(options.body ? { "content-type": "application/json" } : {}) }, ...(options.body ? { body: JSON.stringify(options.body) } : {}) });
  const data = await res.json().catch(() => null);
  if (!res.ok) { if (data?.error?.code === "google_reconnect" || data?.error?.code === "google_permission" || res.status === 401 || res.status === 423) forgetWorkspace(); throw new Error(data?.error?.message ?? "接続できませんでした。もう一度お試しください"); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Google連携の応答を確認できませんでした。もう一度お試しください");
  if (firebase().auth.currentUser?.uid !== current.uid) throw new Error("アカウントが変更されました。もう一度お試しください");
  return data as T;
}
