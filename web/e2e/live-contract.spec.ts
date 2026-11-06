import { expect, test } from "@playwright/test";

test("Googleログイン前の参加を防ぎ、生徒に教師権限を自己設定させない", async ({ page }) => {
  await page.goto("/join?code=DEMO01");
  await expect(page.getByRole("button", { name: "参加する", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "テスト用の生徒でログイン（エミュレータ）" }).click();
  await expect(page.getByRole("button", { name: "参加する", exact: true })).toBeEnabled();
  await page.goto("/signup");
  await expect(page.getByRole("button", { name: /^先生/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^生徒/ })).toBeEnabled();
});

test("APIがHTMLを返す通信障害でも、内部情報を表示せず入力を保持する", async ({ page }) => {
  await page.goto("/join?code=ZZZZZZ");
  await page.getByRole("button", { name: "テスト用の生徒でログイン（エミュレータ）" }).click();
  await page.route("**/api/rooms/join", route => route.fulfill({ status: 502, contentType: "text/html", body: "<html>PRIVATE-UPSTREAM-DETAILS</html>" }));
  await page.getByRole("button", { name: "参加する", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("サーバーに接続できませんでした");
  await expect(page.getByLabel("参加コード")).toHaveValue("ZZZZZZ");
  await expect(page.locator("main")).not.toContainText("PRIVATE-UPSTREAM-DETAILS");
});
