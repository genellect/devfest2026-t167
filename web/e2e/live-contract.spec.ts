import { expect, test } from "@playwright/test";
import { loginStudent } from "./student";

test("Googleログイン前の参加を防ぎ、ログイン後は属性を自己設定せずホストできる", async ({ page }) => {
  await page.goto("/join?code=999999");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByLabel("参加コード")).toHaveCount(0);
  // ログインのあと、QRのコードでそのまま参加を試みる（このコードの部屋はない）
  await loginStudent(page, "", { home: false });
  await expect(page).toHaveURL(/\/join$/);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("参加コードが見つかりません");
  await expect(page.getByLabel("参加コード")).toHaveValue("999999");
  await page.goto("/signup");
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("heading", { name: "ホーム", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "ホストする", exact: true })).toBeEnabled();
});

test("APIがHTMLを返す通信障害でも、内部情報を表示せず入力を保持する", async ({ page }) => {
  await loginStudent(page);
  await page.route("**/api/rooms/join", route => route.fulfill({ status: 502, contentType: "text/html", body: "<html>PRIVATE-UPSTREAM-DETAILS</html>" }));
  await page.goto("/join?code=123456");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("サーバーに接続できませんでした");
  await expect(page.getByLabel("参加コード")).toHaveValue("123456");
  await expect(page.getByRole("main")).not.toContainText("PRIVATE-UPSTREAM-DETAILS");
});
