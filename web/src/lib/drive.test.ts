import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  auth: { currentUser: { uid: "one", email: "one@example.com" } as { uid: string; email: string } | null },
  options: { apiKey: "public-fixture-key", appId: "1:12345:web:fixture" } as { apiKey?: string; appId?: string },
  popup: vi.fn(async () => ({ accessToken: "fixture-access-token" })),
  request: vi.fn<typeof fetch>(),
}));
vi.mock("./firebase", () => ({ firebase: () => ({ auth: state.auth, app: { options: state.options } }) }));
vi.mock("./session", () => ({ authenticatedFetch: state.request }));
vi.mock("firebase/auth", () => ({
  browserPopupRedirectResolver: {},
  GoogleAuthProvider: class {
    static credentialFromResult(result: { accessToken: string }) { return result; }
    addScope(scope: string) { expect(scope).toBe("https://www.googleapis.com/auth/drive.file"); }
    setCustomParameters() {}
  },
  reauthenticateWithPopup: state.popup,
  onAuthStateChanged: () => () => {},
}));
import { authorizeDrive, forgetDrive, materialRequest, pickDriveFile, SCOPES } from "./drive";
afterEach(() => {
  forgetDrive(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); state.popup.mockClear(); state.request.mockReset();
  state.auth.currentUser = { uid: "one", email: "one@example.com" }; state.options.apiKey = "public-fixture-key";
});

it("Driveだけの追加同意を求め、タブ内で同じ本人の有効なトークンだけ再利用する", async () => {
  vi.stubEnv("NEXT_PUBLIC_USE_EMULATORS", "0");
  expect(await authorizeDrive(SCOPES.drive)).toBe("fixture-access-token");
  expect(await authorizeDrive(SCOPES.drive)).toBe("fixture-access-token");
  expect(state.popup).toHaveBeenCalledTimes(1);
  state.auth.currentUser = { uid: "two", email: "two@example.com" };
  await authorizeDrive(SCOPES.drive); expect(state.popup).toHaveBeenCalledTimes(2);
});

it("未ログインと模擬ログインから実Googleへ接続しない", async () => {
  state.auth.currentUser = null; await expect(authorizeDrive(SCOPES.drive)).rejects.toThrow("Googleでログイン");
  state.auth.currentUser = { uid: "one", email: "one@example.com" }; vi.stubEnv("NEXT_PUBLIC_USE_EMULATORS", "1");
  await expect(authorizeDrive(SCOPES.drive)).rejects.toThrow("実Googleログインの環境"); expect(state.popup).not.toHaveBeenCalled();
});

it("OAuthのキャンセルやポップアップ拒否を利用者向けに表示する", async () => {
  vi.stubEnv("NEXT_PUBLIC_USE_EMULATORS", "0");
  state.popup.mockRejectedValueOnce({ code: "auth/popup-closed-by-user" }); await expect(authorizeDrive(SCOPES.drive)).rejects.toThrow("キャンセル");
  state.popup.mockRejectedValueOnce({ code: "auth/popup-blocked" }); await expect(authorizeDrive(SCOPES.drive)).rejects.toThrow("ポップアップを許可");
});

it.each(["picked", "cancel"])("Google Pickerの %s を扱い、選択後にPickerを閉じる", async action => {
  const seen: Record<string, unknown> = {}; let callback: (value: unknown) => void = () => {};
  const dispose = vi.fn();
  class DocsView {
    setIncludeFolders() { return this; }
    setMimeTypes(types: string) { seen.types = types; return this; }
  }
  class PickerBuilder {
    addView() { return this; } setOAuthToken(token: string) { seen.token = token; return this; }
    setDeveloperKey(key: string) { seen.key = key; return this; } setAppId(id: string) { seen.id = id; return this; }
    setOrigin(origin: string) { seen.origin = origin; return this; }
    setCallback(cb: typeof callback) { callback = cb; return this; }
    build() { return { dispose, setVisible() { callback({ action, docs: [{ id: "chosen-file", name: "選んだ資料" }] }); } }; }
  }
  vi.stubGlobal("window", { location: { origin: "https://app.example" }, google: { picker: { DocsView, PickerBuilder } } });
  expect(await pickDriveFile("fixture-access-token")).toEqual(action === "picked" ? { id: "chosen-file", name: "選んだ資料" } : null);
  expect(seen).toMatchObject({ key: "public-fixture-key", id: "12345", origin: "https://app.example" });
  expect(String(seen.types)).toContain("application/pdf"); expect(dispose).toHaveBeenCalledOnce();
});

it("接続エラーやHTML応答をそのまま表示せず、資料追加の同意をAPIへ渡す", async () => {
  state.request.mockResolvedValueOnce(Response.json({ file: { id: "file" } }));
  await materialRequest("/rooms/room/materials", { token: "fixture-token", body: { fileId: "file", shareCopy: true } });
  expect(state.request.mock.calls[0][1]?.body).toBe(JSON.stringify({ fileId: "file", shareCopy: true }));
  state.request.mockResolvedValueOnce(new Response("private-upstream-error", { status: 502 }));
  await expect(materialRequest("/rooms/room/materials")).rejects.toThrow("接続できませんでした");
});
