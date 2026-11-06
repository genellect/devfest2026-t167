import { expect, type Page } from "@playwright/test";

/** 新規の生徒も、ログイン・役割選択を済ませてホームから参加する。 */
export async function loginStudent(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "テスト用の生徒でログイン（エミュレータ）" }).click();
  await page.waitForURL(/\/(signup|student)$/);
  if (new URL(page.url()).pathname === "/signup") await page.getByRole("button", { name: /^生徒/ }).click();
  await expect(page).toHaveURL(/\/student$/);
  await expect(page.getByRole("heading", { name: "あなたのホーム" })).toBeVisible();
}
