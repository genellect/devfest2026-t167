import { expect, test } from "@playwright/test";
import { loginStudent } from "./student";

test("Googleログイン前の参加を防ぎ、生徒に教師権限を自己設定させない", async ({ page }) => {
  await page.goto("/join?code=999999");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByLabel("参加コード")).toHaveCount(0);
  // ログインのあと、QRのコードでそのまま参加を試みる（このコードの部屋はない）
  await loginStudent(page, "", { home: false });
  await expect(page).toHaveURL(/\/join$/);
  await expect(page.locator("main").getByRole("alert")).toContainText("参加コードが見つかりません");
  await expect(page.getByLabel("参加コード")).toHaveValue("999999");
  await page.goto("/signup");
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.locator("main .mvp-actions").getByRole("link", { name: "参加する" })).toBeVisible();
});

test("APIがHTMLを返す通信障害でも、内部情報を表示せず入力を保持する", async ({ page }) => {
  await loginStudent(page);
  await page.route("**/api/rooms/join", route => route.fulfill({ status: 502, contentType: "text/html", body: "<html>PRIVATE-UPSTREAM-DETAILS</html>" }));
  await page.goto("/join?code=123456");
  await expect(page.locator("main").getByRole("alert")).toContainText("サーバーに接続できませんでした");
  await expect(page.getByLabel("参加コード")).toHaveValue("123456");
  await expect(page.locator("main")).not.toContainText("PRIVATE-UPSTREAM-DETAILS");
});
