"use client";
import { browserPopupRedirectResolver, GoogleAuthProvider, reauthenticateWithPopup, onAuthStateChanged } from "firebase/auth";
import { firebase } from "./firebase";
import { authenticatedFetch, sessionSnapshot } from "./session";
import { googleLoginError } from "./hostAuth";

export interface Course { id: string; name: string; section?: string; role: "teacher" | "student" }
export interface MaterialFile { id: string; name: string; kind: "pdf" | "document" | "sheet"; originalMimeType?: string; bytes?: number }
export const SCOPES = {
  drive: ["https://www.googleapis.com/auth/drive.file"],
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
  if (process.env.NEXT_PUBLIC_USE_EMULATORS === "1") throw new Error("現在は模擬ログインです。Google連携は実Googleログインの環境で利用できます。通常のセッション作成・参加はこのまま使えます。");
  if (typeof window !== "undefined" && !window.isSecureContext) throw new Error("Google連携はHTTPSまたはlocalhostで開いてください。");
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
interface PickerResult { action: string; docs?: { id: string; name: string }[] }
interface PickerView { setMimeTypes(types: string): PickerView; setIncludeFolders(value: boolean): PickerView }
interface PickerBuilder { addView(view: PickerView): PickerBuilder; setOAuthToken(token: string): PickerBuilder; setDeveloperKey(key: string): PickerBuilder; setAppId(id: string): PickerBuilder; setOrigin(origin: string): PickerBuilder; setCallback(callback: (result: PickerResult) => void): PickerBuilder; build(): { setVisible(visible: boolean): void; dispose(): void } }
interface PickerApi { DocsView: new () => PickerView; PickerBuilder: new () => PickerBuilder }
type GoogleWindow = Window & { gapi?: { load(name: string, options: { callback: () => void; onerror: () => void; timeout: number; ontimeout: () => void }): void }; google?: { picker?: PickerApi } };
let pickerReady: Promise<void> | undefined;
export function preparePicker() {
  return pickerReady ??= new Promise<void>((resolve, reject) => {
    const w = window as GoogleWindow;
    const timer = setTimeout(() => fail(), 15000);
    const done = () => { clearTimeout(timer); resolve(); };
    const fail = () => { clearTimeout(timer); pickerReady = undefined; reject(new Error("資料選択を読み込めませんでした。接続を確認して再度お試しください")); };
    const loaded = () => { if (w.gapi) w.gapi.load("picker", { callback: done, onerror: fail, timeout: 15000, ontimeout: fail }); else fail(); };
    if (w.google?.picker) { done(); return; }
    if (w.gapi) { loaded(); return; }
    const script = document.createElement("script"); script.src = "https://apis.google.com/js/api.js"; script.async = true; script.onload = loaded; script.onerror = fail; document.head.append(script);
  });
}
/** 公式Pickerで選択されたファイルだけdrive.fileの対象にする。 */
export async function pickDriveFile(token: string): Promise<{ id: string; name: string } | null> {
  const options = firebase().app.options;
  const key = process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY || options.apiKey;
  const appId = process.env.NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER || options.appId?.split(":")[1];
  if (!key || !appId) throw new Error("Drive選択用のGoogle Cloud設定が必要です");
  await preparePicker();
  const api = (window as GoogleWindow).google?.picker; if (!api) throw new Error("資料選択を読み込めませんでした");
  return new Promise((resolve, reject) => {
    const view = new api.DocsView().setIncludeFolders(true).setMimeTypes("application/pdf,application/vnd.google-apps.document,application/vnd.google-apps.presentation,application/vnd.google-apps.spreadsheet");
    const picker = new api.PickerBuilder().addView(view).setOAuthToken(token).setDeveloperKey(key).setAppId(appId).setOrigin(window.location.origin).setCallback(data => {
      if (data.action === "picked" || data.action === "cancel") { resolve(data.action === "picked" ? data.docs?.[0] ?? null : null); picker.dispose(); }
      if (data.action === "error") { picker.dispose(); reject(new Error("Googleドライブを開けませんでした。Google側の設定とアクセス許可を確認してください。")); }
    }).build(); picker.setVisible(true);
  });
}
