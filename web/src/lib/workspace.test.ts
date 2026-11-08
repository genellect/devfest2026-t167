import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ reauth: vi.fn(), credential: vi.fn(), observer: vi.fn(), request: vi.fn(), auth: { currentUser: { uid: "user", email: "user@example.com" } as { uid: string; email: string } | null }, scopes: [] as string[] }));
vi.mock("./firebase", () => ({ firebase: () => ({ auth: mocks.auth, app: { options: { apiKey: "public-key", appId: "1:123:web:test" } } }) }));
vi.mock("./session", () => ({ authenticatedFetch: mocks.request, sessionSnapshot: () => ({ status: "active" }) }));
vi.mock("./hostAuth", () => ({ googleLoginError: () => "Googleの許可を確認してください" }));
vi.mock("firebase/auth", () => ({ browserPopupRedirectResolver: {}, GoogleAuthProvider: class { static credentialFromResult() { return mocks.credential(); } addScope(scope: string) { mocks.scopes.push(scope); } setCustomParameters() {} }, reauthenticateWithPopup: mocks.reauth, onAuthStateChanged: mocks.observer }));
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); vi.unstubAllEnvs(); vi.stubEnv("NEXT_PUBLIC_USE_EMULATORS", "0"); vi.stubEnv("NEXT_PUBLIC_CLASSROOM_MOCK", "0"); mocks.scopes = []; mocks.auth.currentUser = { uid: "user", email: "user@example.com" }; mocks.reauth.mockResolvedValue({}); mocks.credential.mockReturnValue({ accessToken: "test-private-token" }); });
it("追加許可は必要なスコープだけを要求し、同じ本人の有効なトークンをメモリで再利用する", async () => {
  const w = await import("./workspace"); expect(await w.authorizeWorkspace(w.SCOPES.classroom)).toBe("test-private-token");
  expect(mocks.scopes).toEqual(w.SCOPES.classroom); await w.authorizeWorkspace(w.SCOPES.classroom); expect(mocks.reauth).toHaveBeenCalledTimes(1);
  await w.authorizeWorkspace(w.SCOPES.roster); expect(mocks.reauth).toHaveBeenCalledTimes(2);
  expect(w.workspaceToken()).toBe("test-private-token"); w.forgetWorkspace(); expect(() => w.workspaceToken()).toThrow();
});
it("ログアウト・アカウント変更・エミュレータでは実Googleのトークンを再利用しない", async () => {
  const w = await import("./workspace"); await w.authorizeWorkspace(w.SCOPES.drive);
  mocks.auth.currentUser = { uid: "another", email: "other@example.com" }; expect(() => w.workspaceToken()).toThrow();
  mocks.auth.currentUser = null; await expect(w.authorizeWorkspace(w.SCOPES.drive)).rejects.toThrow("ログイン");
  mocks.auth.currentUser = { uid: "user", email: "user@example.com" }; vi.stubEnv("NEXT_PUBLIC_USE_EMULATORS", "1");
  await expect(w.authorizeWorkspace(w.SCOPES.drive)).rejects.toThrow("実Googleログイン");
});
it("拒否やポップアップ中の本人変更を安全な案内にする", async () => {
  const w = await import("./workspace"); mocks.reauth.mockRejectedValueOnce(new Error("private provider data"));
  await expect(w.authorizeWorkspace(w.SCOPES.drive)).rejects.toThrow("Googleの許可");
  mocks.credential.mockReturnValue(null); await expect(w.authorizeWorkspace(w.SCOPES.drive)).rejects.toThrow("Googleの許可");
});
it("GoogleトークンをURLへ含めずヘッダーで送り、再接続エラーでは保存を解除する", async () => {
  const w = await import("./workspace"); const token = await w.authorizeWorkspace(w.SCOPES.drive);
  mocks.request.mockResolvedValueOnce(new Response(JSON.stringify({ files: [] })));
  expect(await w.workspaceRequest("/rooms/r/materials", { token })).toEqual({ files: [] });
  expect(mocks.request.mock.calls[0][0]).toBe("/rooms/r/materials"); expect(mocks.request.mock.calls[0][1].headers).toMatchObject({ "x-google-access-token": token });
  mocks.request.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "google_reconnect", message: "再接続" } }), { status: 409 }));
  await expect(w.workspaceRequest("/x", { token, body: {} })).rejects.toThrow("再接続"); expect(() => w.workspaceToken()).toThrow();
});
it("失効したアプリセッションでは追加トークンを再利用せず、壊れた応答を成功扱いしない", async () => {
  const w = await import("./workspace"); const token = await w.authorizeWorkspace(w.SCOPES.classroom);
  mocks.request.mockResolvedValueOnce(new Response('null'));
  await expect(w.workspaceRequest('/integrations/classroom/courses',{token})).rejects.toThrow('応答を確認');
  mocks.request.mockResolvedValueOnce(new Response(JSON.stringify({error:{code:'session_revoked',message:'再ログイン'}}),{status:401}));
  await expect(w.workspaceRequest('/integrations/classroom/courses',{token})).rejects.toThrow('再ログイン');
  expect(()=>w.workspaceToken()).toThrow();
});
