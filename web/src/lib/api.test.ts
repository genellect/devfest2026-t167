import { afterEach, describe, expect, it, vi } from "vitest";
const { getIdToken } = vi.hoisted(() => ({ getIdToken: vi.fn(async (refresh: boolean) => refresh ? "fresh-token" : "old-token") }));
vi.mock("./firebase", () => ({ ensureSignedIn: async () => ({ getIdToken }) }));
import { callApi, uploadRecording } from "./api";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); getIdToken.mockClear(); });
describe("画面とAPIの接続", () => {
  it("同じオリジンへ送り、401でだけトークンを更新して1回再送する", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('{"error":{"code":"unauthenticated"}}', { status: 401 }))
      .mockResolvedValueOnce(Response.json({ roomId: "room" }));
    vi.stubGlobal("fetch", fetcher);
    expect(await callApi("/rooms", { title: "架空の授業" })).toEqual({ roomId: "room" });
    expect(fetcher.mock.calls[0][0]).toBe("/api/rooms");
    expect(getIdToken.mock.calls).toEqual([[false], [true]]);
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get("authorization")).toBe("Bearer fresh-token");
  });
  it("5xxやHTML応答は繰り返さず、応答本文をそのまま表示しない", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("<html>internal-details</html>", { status: 502 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(callApi("/rooms")).rejects.toMatchObject({ status: 502, code: "upstream_error" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>invalid</html>", { status: 200 })));
    await expect(callApi("/rooms")).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("録音Blobと同意・時間を送り、失敗時には再送用の同じBlobを維持する", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ group: 1, status: "done" }));
    vi.stubGlobal("fetch", fetcher);
    const blob = new Blob(["synthetic"], { type: "audio/wav" });
    await uploadRecording("room", blob, 1.9);
    expect(fetcher.mock.calls[0][0]).toBe("/api/rooms/room/groups/recording?consent=1&durationSec=2");
    expect(fetcher.mock.calls[0][1]?.body).toBe(blob);
  });
  it("429の待機秒数・追跡IDを保持する", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "audio_busy", message: "待機してください" } }, { status: 429, headers: { "retry-after": "3", "x-request-id": "test-id" } })));
    await expect(callApi("/rooms")).rejects.toMatchObject({ code: "audio_busy", retryAfterSec: 3, requestId: "test-id" });
  });
  it("時間切れでは通信を中断し、タイマーを回収する", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }))));
    const pending = callApi("/rooms");
    const assertion = expect(pending).rejects.toMatchObject({ code: "request_timeout" });
    await vi.advanceTimersByTimeAsync(30_001); await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("通信断を利用者向けのエラーとして返す", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("private network details"); }));
    await expect(callApi("/rooms")).rejects.toMatchObject({ status: 0, code: "network_unavailable" });
  });
});

it("ログイン失効を通信断と区別する", async () => {
  getIdToken.mockRejectedValueOnce({ code: "auth/user-token-expired" });
  await expect(callApi("/rooms")).rejects.toMatchObject({ status: 401, code: "login_required" });
});
