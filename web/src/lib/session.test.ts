import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getIdToken: vi.fn(async () => "synthetic-id-token"), signOut: vi.fn(async () => {}), preserve: vi.fn(async () => {}) }));
vi.mock("firebase/auth", () => ({ onAuthStateChanged: vi.fn(), signOut: mocks.signOut }));
vi.mock("./firebase", () => ({ firebase: () => ({ auth: { authStateReady: async () => {}, currentUser: { uid: "synthetic-user", getIdToken: mocks.getIdToken } } }) }));
vi.mock("./recording-recovery", () => ({ preserveRecordings: mocks.preserve }));
import { authenticatedFetch, handleSessionFailure, logoutSession, sessionSnapshot } from "./session";
beforeEach(() => { mocks.getIdToken.mockClear(); mocks.signOut.mockClear(); mocks.preserve.mockClear(); });
afterEach(() => { vi.unstubAllGlobals(); });
it("セッション失効時にrefreshやセッション再作成で迂回しない", async () => {
  const fetcher = vi.fn(async () => Response.json({ error: { code: "session_revoked", reason: "replaced" } }, { status: 401 }));
  vi.stubGlobal("fetch", fetcher);
  await authenticatedFetch("/rooms/join", { method: "POST" });
  await vi.waitFor(() => expect(mocks.signOut).toHaveBeenCalledOnce());
  expect(fetcher).toHaveBeenCalledTimes(1); expect(mocks.getIdToken.mock.calls).toEqual([[false]]);
  expect(sessionSnapshot().reason).toBe("replaced");
});
it("Firebaseトークンだけが無効なら一度だけ更新する", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: { code: "unauthenticated" } }, { status: 401 })).mockResolvedValueOnce(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetcher);
  const result = await authenticatedFetch("/rooms", { method: "POST" });
  expect(result.ok).toBe(true); expect(mocks.getIdToken.mock.calls).toEqual([[false], [true]]);
  expect(fetcher.mock.calls[0][1].credentials).toBe("same-origin");
});
it("ロック時は録音の保存が終わるまで画面を維持し、Firebaseログアウトしない", async () => {
  let release!: () => void;
  mocks.preserve.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
  const task = handleSessionFailure("session_locked");
  expect(sessionSnapshot().status).toBe("saving"); expect(mocks.signOut).not.toHaveBeenCalled();
  release(); await task;
  expect(sessionSnapshot().status).toBe("locked"); expect(mocks.signOut).not.toHaveBeenCalled();
});
it("サーバーログアウトの通信失敗を成功扱いにしない", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
  await expect(logoutSession()).rejects.toThrow(); expect(mocks.signOut).not.toHaveBeenCalled();
});
it("期限切れでも録音保存を先に完了させる", async () => {
  const order: string[] = [];
  mocks.preserve.mockImplementationOnce(async () => { order.push("saved"); });
  mocks.signOut.mockImplementationOnce(async () => { order.push("signed-out"); });
  await handleSessionFailure("session_revoked", "idle_expired");
  expect(order).toEqual(["saved", "signed-out"]);
});

it("Firebase SDKで無効化を検出した場合も、録音保存後にログアウトする", async () => {
  mocks.getIdToken.mockRejectedValueOnce({ code: "auth/user-disabled" });
  await expect(authenticatedFetch("/sessions/current")).rejects.toMatchObject({ status: 401, code: "session_required" });
  await vi.waitFor(() => expect(mocks.signOut).toHaveBeenCalledOnce());
  expect(mocks.preserve).toHaveBeenCalledOnce();
});
