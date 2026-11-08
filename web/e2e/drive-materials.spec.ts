import { expect, test } from "@playwright/test";
import { loginGoogle } from "./google";

test("Hostの共有資料を開け、模擬ログインのまま実Googleとして取り込まない", async ({ page }, info) => {
  await page.goto("/");
  await loginGoogle(page, "teacher", `drive-host-${Date.now()}`);
  await expect(page).toHaveURL(/\/home$/);
  await page.getByRole("link", { name: "ホストする", exact: true }).click();
  await page.getByLabel("セッション名", { exact: true }).fill("Drive連携の確認");
  await page.getByLabel("テーマ", { exact: true }).fill("試験用資料を確認する");
  await page.getByRole("button", { name: "セッションを作成", exact: true }).click();
  await expect(page).toHaveURL(/\/rooms\//);
  const manager = page.getByRole("region", { name: "共有資料の管理", exact: true });
  const add = manager.getByRole("button", { name: "ドライブから追加", exact: true });
  await expect(add).toBeDisabled();
  await manager.getByRole("checkbox").check();
  await add.click();
  await expect(manager.getByRole("alert")).toContainText("模擬ログイン");
  await expect(add).toBeEnabled();
  await expect(page.getByRole("region", { name: "参加コード", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("drive-material-manager.png"), fullPage: true });
});
