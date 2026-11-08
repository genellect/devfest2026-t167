import { enterCurrentSession } from "./current-session";
import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
import { emulatorGoogleUser } from "../../firebase/emulator-auth.mjs";
import { loginStudent } from "./student";

async function enterDiscussion(page: Page, request: APIRequestContext) {
  const teacher = await emulatorGoogleUser("teacher", `mic-${Date.now()}`);
  const headers = { authorization: `Bearer ${teacher.idToken}` };
  await request.post("/api/sessions", { headers, data: { deviceLabel: "テスト端末", deviceType: "pc" } });
  const response = await request.post("/api/rooms", { headers, data: { flowVersion: 1, title: "ブラウザのマイク許可" } });
  expect(response.status()).toBe(201);
  const { roomId, joinCode } = await response.json();
  await loginStudent(page);
  await page.goto(`/join?code=${joinCode}`);
  await expect(page).toHaveURL(/\/rooms\//);
  await enterCurrentSession(page);

  await request.post(`/api/rooms/${roomId}/phase`, { headers, data: { to: "discussing" } });
}

test("ブラウザのマイク拒否から再試行でき、録音の破棄では音声を送信しない", async ({ page, request }) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let rejected = false;
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (!rejected && constraints?.audio) {
        rejected = true;
        throw new DOMException("Denied", "NotAllowedError");
      }
      return original(constraints);
    };
  });
  await enterDiscussion(page, request);
  const uploads: string[] = [];
  page.on("request", r => { if (r.url().includes("/groups/recording")) uploads.push(r.url()); });
  await page.getByRole("button", { name: "録音を始める", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "マイクが使えません" })).toBeVisible();
  await page.getByRole("button", { name: "もう一度試す", exact: true }).click();
  await expect(page.getByText("録音中", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "設定を開く", exact: true }).click();
  await page.getByRole("button", { name: "録音を破棄", exact: true }).click();
  await expect(page.getByRole("button", { name: "録音を始める", exact: true })).toBeEnabled();
  expect(uploads).toEqual([]);
});

test("ブラウザ側でマイクが終了した場合も録音を停止して端末に保管する", async ({ page, request }) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      Reflect.set(window, "endTestMicrophone", () => {
        stream.getAudioTracks().forEach(track => { track.stop(); track.dispatchEvent(new Event("ended")); });
      });
      return stream;
    };
  });
  await enterDiscussion(page, request);
  await page.getByRole("button", { name: "録音を始める", exact: true }).click();
  await expect(page.getByText("録音中", { exact: true })).toBeVisible();
  await page.waitForTimeout(1100);
  await page.evaluate(() => Reflect.get(window, "endTestMicrophone")());
  await expect(page.getByText("録音は停止済みです", { exact: true })).toBeVisible();
  await page.goto("/sessions");
  await page.getByRole("button", { name: "再生・ダウンロード", exact: true }).first().click();
  const audio = page.locator("audio").first();
  await expect(audio).toBeVisible();
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.readyState)).toBeGreaterThan(0);
  expect(await audio.evaluate((element: HTMLAudioElement) => element.error)).toBeNull();
});
