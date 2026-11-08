import { loginGoogle } from "./google";
import { expect, test } from "@playwright/test";

test("教員のホームから作成し、開始・強制終了・結果・教員のホームへ進む", async ({ page }) => {
  await page.goto("/");
  await loginGoogle(page, "teacher");
  await expect(page).toHaveURL(/\/home$/);
  await page.getByRole("link", { name: "ホストする", exact: true }).click();
  await page.getByLabel("テーマ", { exact: true }).fill("チームで何を作るか");
  await page.getByLabel("セッション名", { exact: true }).fill("チーム作成の記録");
  await page.getByRole("button", { name: "セッションを作成", exact: true }).click();
  await expect(page).toHaveURL(/\/rooms\//);
  await page.getByRole("button", { name: "議論を開始", exact: true }).click();
  // 時間は設定しない。教員が終えるまで議論が続く
  await expect(page.getByRole("button", { name: "議論を終える", exact: true })).toBeVisible();
  // 教員には経過時間だけを出す（残り時間のカウントダウンは出さない）
  await expect(page.getByRole("timer", { name: "経過時間" })).toBeVisible();
  await expect(page.getByRole("timer", { name: "残り時間" })).toHaveCount(0);
  await page.getByRole("button", { name: "議論を終える", exact: true }).click();
  await page.getByRole("button", { name: "終えて結果を見る", exact: true }).click();
  await expect(page.getByRole("heading", { name: "録音の振り返り", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "ホームに戻る", exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.getByRole("button", { name: "メニュー", exact: true }).click();
  await page.getByRole("dialog", { name: "ホームのメニュー", exact: true }).getByRole("link", { name: "履歴", exact: true }).click();
  await expect(page.getByRole("list", { name: "議論の履歴", exact: true }).getByRole("link", { name: /チームで何を作るか/ }).first()).toContainText("終了");
});
