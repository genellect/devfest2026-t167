import { expect, test } from "@playwright/test";
import { emulatorGoogleUser } from "../../firebase/emulator-auth.mjs";
import { fakeQrCamera, loginStudent } from "./student";

test("GuestはQR・表示名・初回音声登録・待機・Host開始・許可情報・結果を通り、次回は声を再利用する", async ({ page, playwright }) => {
  const host = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const user = await emulatorGoogleUser("student", `flow-host-${Date.now()}`), headers = { authorization: `Bearer ${user.idToken}` };
    expect((await host.post("/api/sessions", { headers, data: { deviceLabel: "Host端末", deviceType: "pc" } })).status()).toBe(201);
    async function create() { const r = await host.post("/api/rooms", { headers, data: { title: "新しいMVPフロー", theme: "秘密のテーマ", minutes: 1, groups: 1, recording: false, flowVersion: 1 } }); expect(r.status()).toBe(201); return r.json(); }
    const r = await create();
    await fakeQrCamera(page, `${test.info().project.use.baseURL}/join?code=${r.joinCode}`);
    await loginStudent(page);
    await page.locator(".mvp-actions").getByRole("link", { name: "参加する" }).click();
    await page.getByRole("link", { name: "ゲスト", exact: true }).click();
    // アプリ内のカメラでQRを読み取ると、ボタンを押さずにそのまま参加する
    await page.getByRole("button", { name: "QRコードを読み取る", exact: true }).click();
    await page.getByLabel("参加者1の表示名").fill("架空のGuest");
    await page.getByRole("button", { name: "表示名を保存して進む" }).click();
    await expect(page.getByRole("heading", { name: "初回の音声登録" })).toBeVisible();
    await page.getByLabel("声の特徴の登録と、上記の利用方法に同意します").check();
    await page.getByRole("button", { name: "声を登録する", exact: true }).click();
    await expect(page.getByRole("heading", { name: "待機画面" })).toBeVisible({ timeout: 20_000 });
    expect((await host.post(`/api/rooms/${r.roomId}/phase`, { headers, data: { to: "discussing" } })).status()).toBe(200);
    await expect(page.getByRole("heading", { name: "グループで話し合いましょう" })).toBeVisible();
    await expect(page.getByText("テーマ：秘密のテーマ")).toBeVisible();
    // 開始後にホームへ戻っても、同じコードで議論の画面に戻れる
    await page.getByRole("link", { name: "ホームに戻る" }).click();
    await page.goto(`/join?code=${r.joinCode}`);
    await expect(page).toHaveURL(/\/rooms\//);
    await expect(page.getByRole("heading", { name: "グループで話し合いましょう" })).toBeVisible();
    expect((await host.post(`/api/rooms/${r.roomId}/settings`, { headers, data: { participantView: { theme: false, timer: false, members: false } } })).status()).toBe(200);
    await expect(page.getByText("テーマ：秘密のテーマ")).toHaveCount(0);
    await expect(page.getByRole("timer")).toHaveCount(0);
    expect((await host.post(`/api/rooms/${r.roomId}/finish`, { headers, data: {} })).status()).toBe(200);
    await expect(page.getByRole("heading", { name: "ディスカッションの結果" })).toBeVisible();
    await page.getByRole("link", { name: "ホームに戻る" }).click();
    const next = await create(); await page.goto(`/join?code=${next.joinCode}`);
    await expect(page).toHaveURL(/\/rooms\//);
    await page.getByLabel("参加者1の表示名").fill("次回の表示名");
    await page.getByRole("button", { name: "表示名を保存して進む" }).click();
    await expect(page.getByRole("heading", { name: "待機画面" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "初回の音声登録" })).toHaveCount(0);
  } finally { await host.dispose(); }
});
