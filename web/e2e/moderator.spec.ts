import { expect, test } from "@playwright/test";
import { loginStudent } from "./student";

test("共通ホームからホストを選択し、管理画面で設定して開始・強制終了・結果・ホームへ進む", async ({ page }) => {
  await loginStudent(page);
  await page.getByRole("link", { name: "ディスカッションを作る（教員）", exact: true }).click();
  await page.getByLabel("テーマ", { exact: true }).fill("チームで何を作るか");
  await page.getByRole("button", { name: "作成する", exact: true }).click();
  await expect(page).toHaveURL(/\/rooms\//);
  await page.getByText("セッション設定・グループ管理", { exact: true }).click();
  await page.getByRole("button", { name: "セッションを開始", exact: true }).click();
  // 時間は設定しない。教員が終えるまで議論が続く
  await expect(page.getByRole("button", { name: "セッションを終える", exact: true })).toBeVisible();
  await expect(page.getByRole("timer")).toHaveCount(0);
  await page.getByRole("button", { name: "セッションを終える", exact: true }).click();
  await page.getByRole("button", { name: "終えて結果を見る", exact: true }).click();
  await expect(page.getByRole("heading", { name: "セッション全体の結果", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "ホームに戻る", exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
});
