import { expect, test } from "@playwright/test";
import { loginStudent } from "./student";

for (const path of ["/student", "/join", "/signup", "/host", "/host/new", "/host/profile", "/rooms/not-a-member"]) {
  test(`未ログインの直接アクセスをログイン画面へ戻す: ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("button", { name: "Googleでログイン", exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "メニュー" })).toHaveCount(0);
    await expect(page.getByLabel("参加コード")).toHaveCount(0);
  });
}

test("ログアウト後の戻る・再読込でもホームへ進めない", async ({ page }) => {
  await loginStudent(page);
  await expect(page.getByRole("button", { name: "先生として使う" })).toHaveCount(0);
  // ログアウトは設定の画面にある
  await page.goto("/host/profile");
  await page.getByRole("button", { name: "ログアウト", exact: true }).click();
  await expect(page.getByRole("button", { name: "Googleでログイン", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/student");
  await page.reload();
  await expect(page.getByRole("button", { name: "Googleでログイン", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "あなたのホーム" })).toHaveCount(0);
});

test("ログイン前のプライバシー説明にはホームのタブを表示しない", async ({ page }) => {
  await page.goto("/about");
  await expect(page.getByRole("heading", { name: "使い方とプライバシー" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "メニュー" })).toHaveCount(0);
});
