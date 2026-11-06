import { expect, test } from "@playwright/test";
import { loginStudent } from "./student";

test("共通ホームからホストを選択し、管理画面で設定して開始・強制終了・結果・ホームへ進む", async ({ page }) => {
  await loginStudent(page);
  await page.locator(".mvp-actions").getByRole("link", { name: "参加する" }).click();
  await page.getByRole("link", { name: "ホスト", exact: true }).click();
  await page.getByLabel("セッション名", { exact: true }).fill("MVPの進行確認");
  await page.getByLabel("テーマ", { exact: true }).fill("チームで何を作るか");
  await page.getByRole("button", { name: "1", exact: true }).click();
  await page.getByRole("button", { name: "部屋を作る", exact: true }).click();
  await expect(page).toHaveURL(/\/rooms\//);
  await page.getByText("セッション設定・グループ管理", { exact: true }).click();
  await page.getByRole("button", { name: "セッションを開始", exact: true }).click();
  await expect(page.getByRole("timer")).toBeVisible();
  await page.getByRole("button", { name: "セッションを終える", exact: true }).click();
  await page.getByRole("button", { name: "終えて結果を見る", exact: true }).click();
  await expect(page.getByRole("heading", { name: "セッション全体の結果", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "ホームに戻る", exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
});
