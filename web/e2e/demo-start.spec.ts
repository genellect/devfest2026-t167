import { expect, test, type Page } from "@playwright/test";
import { loginStudent } from "./student";

// デモで1人の登録漏れや同意の取り消しがあっても、Hostが始めて終えられ、同意のない録音は送られないことを確かめる。

async function joinAsGuest(guest: Page, code: string, name: string) {
  await guest.goto(`/join?code=${code}`);
  await guest.getByRole("button", { name: "参加する", exact: true }).click();
  await guest.getByLabel("参加者1の表示名").fill(name);
  await guest.getByRole("button", { name: "表示名を保存して進む" }).click();
  await expect(guest.getByRole("heading", { name: "初回の音声登録" })).toBeVisible();
}

test("未準備のGuestを外して開始でき、同意を取り消した録音は終了後も送られない", async ({ page, browser }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "テスト用の先生でログイン（エミュレータ）" }).click();
  await page.waitForURL(/\/home$/); await page.goto("/host/new");
  await page.getByLabel("テーマ", { exact: true }).fill("架空の開始確認");
  await page.getByRole("button", { name: "1", exact: true }).click();
  await page.getByRole("button", { name: "部屋を作る", exact: true }).click();
  await expect(page).toHaveURL(/\/rooms\//);
  await page.getByRole("button", { name: "参加コードを表示", exact: true }).click();
  const code = (await page.getByTestId("join-code").textContent())!.trim();
  await page.getByRole("button", { name: "ダッシュボードを見る" }).click();
  const origin = new URL(page.url()).origin;
  const readyContext = await browser.newContext({ baseURL: origin }), lateContext = await browser.newContext({ baseURL: origin });
  try {
    const ready = await readyContext.newPage(), late = await lateContext.newPage();
    await loginStudent(ready, "ready"); await loginStudent(late, "late");
    await joinAsGuest(ready, code, "準備できたGuest");
    await ready.getByLabel("声の特徴の登録と、上記の利用方法に同意します").check();
    await ready.getByRole("button", { name: "声を登録する", exact: true }).click();
    await expect(ready.getByRole("heading", { name: "待機画面" })).toBeVisible({ timeout: 20_000 });
    await joinAsGuest(late, code, "登録しないGuest");

    await page.getByText("セッション設定・グループ管理", { exact: true }).click();
    await page.getByRole("button", { name: "セッションを開始", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "音声登録または所属が済んでいないGuestが1人います" })).toBeVisible();
    await expect(ready.getByRole("heading", { name: "待機画面" })).toBeVisible();
    await page.getByRole("alert").filter({ hasText: "音声登録または所属が済んでいないGuest" }).screenshot({ path: "../docs/screenshots/mvp-start-exclude-mobile.png" });
    await page.getByRole("button", { name: "未準備のGuestを外して開始", exact: true }).click();
    await expect(ready.getByRole("heading", { name: "グループで話し合いましょう" })).toBeVisible();
    await expect(late.getByText("この部屋を表示できません")).toBeVisible();

    const uploads: string[] = [];
    ready.on("request", (r) => { if (r.url().includes("/groups/recording")) uploads.push(r.url()); });
    const consent = ready.getByLabel("グループ全員が録音・声の照合・発言時間の集計に同意しました");
    await consent.check();
    await ready.getByRole("button", { name: "録音を始める", exact: true }).click();
    await expect(ready.getByRole("button", { name: "録音を停止して端末に保管", exact: true })).toBeVisible();
    await consent.uncheck();
    await expect(ready.getByRole("button", { name: "録音を始める", exact: true })).toBeDisabled();

    await page.getByRole("button", { name: "セッションを終える", exact: true }).click();
    await page.getByRole("button", { name: "終えて結果を見る", exact: true }).click();
    await expect(ready.getByRole("heading", { name: "ディスカッションの結果" })).toBeVisible();
    await ready.waitForTimeout(1_500);
    expect(uploads).toEqual([]);
    await expect(ready.getByText("録音の送信・分析が完了しました。", { exact: true })).toHaveCount(0);
  } finally { await readyContext.close(); await lateContext.close(); }
});
