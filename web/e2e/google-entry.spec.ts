import { expect, test } from "@playwright/test";
import { loginGoogle } from "./google";

test("ログインの入口はGoogleボタン１つで、Cookie拒否から再試行できる", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "サインイン", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "プライバシー" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /テスト用|匿名|ゲスト/ })).toHaveCount(0);
  await page.route("**/api/sessions/current", route => route.fulfill({ status: 401, json: { error: { code: "session_required" } } }));
  await loginGoogle(page, "student", "cookie-entry-test");
  await expect(page.getByRole("alert").filter({ hasText: "Cookieを許可" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await page.unroute("**/api/sessions/current");
  await loginGoogle(page, "student", "cookie-entry-test");
  await expect(page).toHaveURL(/\/home$/);
  const cookie = (await page.context().cookies()).find(c => c.name === "discuss_session_dev");
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/" });
  await page.goto("/");
  await expect(page).toHaveURL(/\/home$/);
});
