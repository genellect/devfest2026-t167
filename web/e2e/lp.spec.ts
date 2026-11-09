import { expect, test } from "@playwright/test";

// 紹介ページ（LP）：ログインなしで開け、LP の中でデモを最後まで体験でき、インストールの案内が出る。

test("ログインなしで LP を開き、ログイン画面へ戻されない", async ({ page }) => {
  await page.goto("/lp");
  await expect(page.getByRole("heading", { level: 1, name: /誰の考えも/ })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page).toHaveURL(/\/lp$/);
  await expect(page.getByRole("button", { name: "Googleでログイン" })).toHaveCount(0);
  await page.screenshot({ path: "../docs/screenshots/lp-hero-mobile.png" });
});

test("LP の中で、書く・話す・まとめるの順にデモを体験できる", async ({ page }) => {
  await page.goto("/lp");
  await page.getByRole("link", { name: "デモを体験" }).first().click();
  const demo = page.locator(".demo");
  await demo.getByRole("button", { name: "例文を入れる" }).click();
  await demo.getByRole("button", { name: "提出する" }).click();
  await expect(demo.getByText("提出しました。本文は、あなたにだけ見えます。")).toBeVisible();
  await demo.getByRole("button", { name: "議論を始める" }).click({ timeout: 10_000 });
  // 未検討の論点は教員の画面に出て、教員が表示を選ぶまで学生には届かない
  await expect(demo.getByText("まだ話されていない論点")).toBeVisible({ timeout: 10_000 });
  await expect(demo.getByLabel("学生の画面").getByText("教員から")).toHaveCount(0);
  await demo.getByRole("button", { name: "全員に表示" }).click();
  await expect(demo.getByLabel("学生の画面").getByText("教員から")).toBeVisible();
  await demo.getByRole("button", { name: "結論をまとめる" }).click();
  await demo.getByRole("radio", { name: "アイデア出しにだけ使える" }).click();
  await expect(demo.getByText("でも、同じことには賛成していなかった。")).toBeVisible();
  await expect(demo.getByText("3人（あなたを含む）")).toBeVisible();
  await demo.screenshot({ path: "../docs/screenshots/lp-demo-mobile.png" });
});

test("インストールを押すと、ホーム画面に追加する手順が出る", async ({ page }) => {
  await page.goto("/lp");
  await page.locator(".sec--end").getByRole("button", { name: "インストール" }).click();
  await expect(page.locator(".sec--end").getByRole("note")).toContainText("ホーム画面に追加");
});
