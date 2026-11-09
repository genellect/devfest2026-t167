"use client";
import { browserPopupRedirectResolver, GoogleAuthProvider, reauthenticateWithPopup, onAuthStateChanged } from "firebase/auth";
import { googleLoginError } from "./hostAuth";
import { firebase } from "./firebase";
import { authenticatedFetch } from "./session";

export interface MaterialFile { id: string; name: string; kind: "pdf" | "document" | "sheet"; originalMimeType?: string; bytes?: number }
export const SCOPES = {
  drive: ["https://www.googleapis.com/auth/drive.file"],
};
let cached: { uid: string; token: string; scopes: string[]; expires: number } | undefined;
let watching = false;
function watch() {
  if (watching) return; watching = true;
  onAuthStateChanged(firebase().auth, user => { if (cached?.uid !== user?.uid) cached = undefined; });
}
/** Googleのアクセストークンは永続化せず、このタブのメモリだけに保持する。 */
export async function authorizeDrive(scopes: readonly string[]) {
  const user = firebase().auth.currentUser; watch();
  if (!user) throw new Error("Googleでログインしてください");
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
  } catch (error) {
    throw new Error(googleLoginError(error));
  }
}
export function forgetDrive() { cached = undefined; }
export async function materialRequest<T>(path: string, options: { token?: string; body?: object; signal?: AbortSignal } = {}): Promise<T> {
  const res = await authenticatedFetch(path, { method: options.body ? "POST" : "GET", signal: options.signal ?? AbortSignal.timeout(90_000), headers: { ...(options.token ? { "x-google-access-token": options.token } : {}), ...(options.body ? { "content-type": "application/json" } : {}) }, ...(options.body ? { body: JSON.stringify(options.body) } : {}) });
  const data = await res.json().catch(() => null);
  if (!res.ok) { if (data?.error?.code === "google_reconnect") forgetDrive(); throw new Error(data?.error?.message ?? "接続できませんでした。もう一度お試しください"); }
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
    const fail = () => { pickerReady = undefined; reject(new Error("資料選択を読み込めませんでした。接続を確認して再度お試しください")); };
    const loaded = () => w.gapi?.load("picker", { callback: resolve, onerror: fail, timeout: 15000, ontimeout: fail });
    if (w.google?.picker) { resolve(); return; }
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
  return new Promise(resolve => {
    const view = new api.DocsView().setIncludeFolders(true).setMimeTypes("application/pdf,application/vnd.google-apps.document,application/vnd.google-apps.presentation,application/vnd.google-apps.spreadsheet");
    const picker = new api.PickerBuilder().addView(view).setOAuthToken(token).setDeveloperKey(key).setAppId(appId).setOrigin(window.location.origin).setCallback(data => {
      if (data.action === "picked" || data.action === "cancel") { resolve(data.action === "picked" ? data.docs?.[0] ?? null : null); picker.dispose(); }
    }).build(); picker.setVisible(true);
  });
}
