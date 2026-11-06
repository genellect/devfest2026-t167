import { expect, test } from "@playwright/test";
import { emulatorGoogleUser } from "../../firebase/emulator-auth.mjs";
import { loginStudent } from "./student";

test("再読み込みで既存セッションを復元し、端末一覧からログアウトできる", async ({ page }) => {
  await loginStudent(page); await page.goto("/sessions");
  await expect(page.getByRole("heading", { name: "ログインしている端末" })).toBeVisible();
  const before = await page.context().cookies();
  await page.reload();
  await expect(page.getByRole("heading", { name: "ログインしている端末" })).toBeVisible();
  expect((await page.context().cookies()).find((c) => c.name === "discuss_session_dev")?.value).toBe(before.find((c) => c.name === "discuss_session_dev")?.value);
  await page.getByRole("button", { name: "全端末からログアウト" }).click();
  await expect(page).toHaveURL(/\/$/); await expect(page.getByRole("status")).toContainText("すべての端末からログアウト");
});

test("別ブラウザの生徒ログインで旧端末が失効し、再読込しても復活しない", async ({ page, browser }) => {
  await loginStudent(page);
  const second = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const other = await second.newPage(); await loginStudent(other);
    await page.reload(); await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("status")).toContainText("別の端末からログインされたため");
    await expect(other.getByRole("link", { name: "参加する", exact: true })).toBeVisible();
  } finally { await second.close(); }
});

test("共用端末は15分の無操作で再認証画面になり、元画面の操作を隠す", async ({ page }) => {
  await page.goto("/"); await page.getByLabel("学校の共用端末で利用する").check();
  const end = new Date(Date.now() + 3600_000), local = new Date(end.getTime() - end.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  await page.getByLabel("授業終了時刻").fill(local);
  await page.getByRole("button", { name: "テスト用の生徒でログイン（エミュレータ）" }).click();
  await page.waitForURL(/\/join$/);
  await page.clock.install(); await page.clock.fastForward(15 * 60_000 + 1000);
  await expect(page.getByRole("dialog", { name: "再認証" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Googleで本人確認" })).toBeVisible();
  await expect(page.getByRole("link", { name: "参加する", exact: true })).toBeHidden();
});

test("録音中の失効は音声を保存してからログアウトし、再ログイン後に再生できる", async ({ page, request }) => {
  const teacher = await emulatorGoogleUser("teacher", `recovery-${Date.now()}`);
  await request.post("/api/sessions", { headers: { authorization: `Bearer ${teacher.idToken}` }, data: { deviceLabel: "架空の教師", deviceType: "pc" } });
  const created = await request.post("/api/rooms", { headers: { authorization: `Bearer ${teacher.idToken}` }, data: { title: "録音の保護確認" } });
  expect(created.status()).toBe(201); const { joinCode, roomId } = await created.json();
  await loginStudent(page); await page.goto(`/join?code=${joinCode}`); await expect(page).toHaveURL(/\/rooms\//);
  await request.post(`/api/rooms/${roomId}/phase`, { headers: { authorization: `Bearer ${teacher.idToken}` }, data: { to: "discussing" } });
  await page.getByLabel("あなたの意見").fill("架空の意見"); await page.getByRole("button", { name: "提出する" }).click();
  await page.getByLabel("グループ全員が、録音することに同意しました").check(); await page.getByRole("button", { name: "録音を始める" }).click();
  await expect(page.getByText(/^録音中・議論を続けてください/)).toBeVisible();
  // MediaRecorderの実際のtimesliceを1回待つ。音声はChromiumの擬似マイク。
  await page.waitForTimeout(15_500);
  const intermediate = await page.evaluate(async () => new Promise<number>((resolve, reject) => {
    const opening = indexedDB.open("discuss-audio-recovery", 1);
    opening.onsuccess = () => { const r = opening.result.transaction("chunks").objectStore("chunks").count(); r.onsuccess = () => { resolve(r.result); opening.result.close(); }; r.onerror = () => reject(new Error("read")); };
  }));
  expect(intermediate).toBeGreaterThan(0);
  await page.context().setOffline(true); await page.waitForTimeout(1000);
  await expect(page.getByText(/^録音中・議論を続けてください/)).toBeVisible();
  await page.context().setOffline(false);
  // サーバーが期限切れを返す場面をモックし、画面の遷移順と保存を検査する。
  await page.route("**/api/sessions/current", route => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { code: "session_revoked", reason: "idle_expired" } }) }));
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page).toHaveURL(/\/$/); await expect(page.getByRole("status")).toContainText("7日間利用がなかった");
  await page.unroute("**/api/sessions/current");
  await page.getByRole("button", { name: "テスト用の生徒でログイン（エミュレータ）" }).click();
  await page.waitForURL(/\/join$/); await page.goto("/sessions");
  await expect(page.getByText(/保存済み・/)).toBeVisible();
  await page.getByRole("button", { name: "再生・ダウンロード" }).click();
  const audio = page.locator("audio"); await expect(audio).toBeVisible();
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.readyState)).toBeGreaterThan(0);
  expect(await audio.evaluate((a: HTMLAudioElement) => a.error)).toBeNull();
});

test("端末容量不足では録音を始めず、既存の議論画面に留まる", async ({ page, request }) => {
  const teacher = await emulatorGoogleUser("teacher", `quota-${Date.now()}`);
  await request.post("/api/sessions", { headers: { authorization: `Bearer ${teacher.idToken}` }, data: { deviceLabel: "架空の教師", deviceType: "pc" } });
  const created = await request.post("/api/rooms", { headers: { authorization: `Bearer ${teacher.idToken}` }, data: { title: "容量の保護確認" } });
  const { joinCode, roomId } = await created.json();
  await loginStudent(page); await page.goto(`/join?code=${joinCode}`); await expect(page).toHaveURL(/\/rooms\//);
  await request.post(`/api/rooms/${roomId}/phase`, { headers: { authorization: `Bearer ${teacher.idToken}` }, data: { to: "discussing" } });
  await page.getByLabel("あなたの意見").fill("架空の意見"); await page.getByRole("button", { name: "提出する" }).click();
  await page.evaluate(() => { navigator.storage.estimate = async () => ({ quota: 100, usage: 99 }); });
  await page.getByLabel("グループ全員が、録音することに同意しました").check(); await page.getByRole("button", { name: "録音を始める" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "保存容量が不足" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "グループで話し合いましょう" })).toBeVisible();
});


test("復元時にAPIが未反映・通信障害でもログイン画面が読み込み中のままにならない", async ({ page }) => {
  await loginStudent(page);
  await page.route("**/api/sessions/current", route => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found" } }) }));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "接続を再確認" })).toBeVisible();
  await page.getByRole("button", { name: "接続を再確認" }).click();
  await expect(page.getByText("接続できません。録音は端末に残し、接続の回復後に再確認します。")).toBeVisible();
  await page.unroute("**/api/sessions/current");
  await page.getByRole("button", { name: "接続を再確認" }).click();
  await expect(page).toHaveURL(/\/join$/);
});
