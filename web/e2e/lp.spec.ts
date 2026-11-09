import { expect, test } from "@playwright/test";

// 紹介ページ（LP）：ログインなしで開け、3機能と AI の役割を示し、ログインと利用の申し込みの入口がある。

test("ログインなしで LP を開き、ログイン画面へ戻されない", async ({ page }) => {
  await page.goto("/lp");
  await expect(page.getByRole("heading", { level: 1, name: /誰の考えも/ })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page).toHaveURL(/\/lp$/);
  await expect(page.getByRole("button", { name: "Googleでログイン" })).toHaveCount(0);
  await page.screenshot({ path: "../docs/screenshots/lp-hero-mobile.png" });
});

test("3機能を、学生のどの力を支えるかとあわせて示す", async ({ page }) => {
  await page.goto("/lp");
  for (const name of ["発言率の可視化", "音声認識による未検討の論点の可視化", "事前の意見から結論への主張の変化の確認"]) {
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "AI は答えを出さない。考えるきっかけを示す。" })).toBeVisible();
  // 動かないデモは置かない
  await expect(page.getByRole("link", { name: "デモを体験" })).toHaveCount(0);
  await page.locator("#features").screenshot({ path: "../docs/screenshots/lp-features-mobile.png" });
});

test("ログインと、これから使う教員・学校の申し込みの入口がある", async ({ page }) => {
  await page.goto("/lp");
  await expect(page.locator(".hero").getByRole("link", { name: "ログイン" })).toHaveAttribute("href", "/");
  const apply = page.getByRole("link", { name: "メールで申し込む" });
  await expect(apply).toHaveAttribute("href", /^mailto:contact@yuto-matsui\.com\?subject=/);
  await page.locator(".hero").getByRole("link", { name: "ログイン" }).click();
  await expect(page.getByRole("button", { name: "Googleでログイン", exact: true })).toBeVisible();
});
