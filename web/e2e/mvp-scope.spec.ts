import { expect, test } from "@playwright/test";
import { loginStudent } from "./student";

test("削除した画面へ直接アクセスしてもデモは開かず、000000も通常の参加APIを通る", async ({ page }) => {
  await loginStudent(page);
  for (const path of ["/host/mock", "/host/mock/dashboard", "/student/voice", "/student/session?code=000000"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "ページが見つかりません", exact: true })).toBeVisible();
  }
  await page.goto("/host/profile");
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByLabel("表示する名前", { exact: true })).toHaveCount(0);
  await page.goto("/sessions");
  await expect(page.getByRole("heading", { name: "学校のセキュリティ設定", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "ログインしている端末", exact: true })).toBeVisible();
  await page.goto("/home?section=goal");
  await expect(page.getByLabel("学びの目標", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "参加する", exact: true }).click();
  await page.getByLabel("参加コード（数字6桁）", { exact: true }).fill("000000");
  await page.getByRole("dialog", { name: "議論に参加する" }).getByRole("button", { name: "参加する", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "議論に参加する" }).getByRole("alert")).toContainText("参加コードが見つかりません");
  await expect(page).toHaveURL(/\/home/);
});
