import { expect, test } from "@playwright/test";

// 紹介ページ（LP）：ログインなしで開け、埋もれた考えの3つの場所と先生にとっての価値を読み進められ、ログインと利用の申し込みの入口がある。

test("ログインなしで LP を開き、ログイン画面へ戻されない", async ({ page }) => {
  await page.goto("/lp");
  await expect(page.getByRole("heading", { level: 1, name: /誰の考えも/ })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page).toHaveURL(/\/lp$/);
  await expect(page.getByRole("button", { name: "Googleでログイン" })).toHaveCount(0);
  await page.screenshot({ path: "../docs/screenshots/lp-hero-mobile.png" });
});

test("スクロールすると、未検討の論点・理解のちがい・先生の見取り図・よくある質問を読める", async ({ page }) => {
  await page.goto("/lp");
  await expect(page.getByRole("heading", { name: /3つの場所で見つけます/ })).toBeAttached();
  const lost = page.locator("#lost");
  await lost.scrollIntoViewIfNeeded();
  // 演出の最後まで進めると、まだ話されていない意見だけが残り、議論中に先生へ届くことが示される
  await page.evaluate(() => { const e = document.querySelector("#lost") as HTMLElement; window.scrollTo(0, e.offsetTop + e.offsetHeight - window.innerHeight); });
  await expect(lost.locator("#lostc")).toHaveClass(/lo/);
  // 場面は画面に貼り付いたまま（position: sticky が効く）。LP の外枠をスクロール領域にすると止まるため確かめる
  await page.evaluate(() => { const e = document.querySelector("#lost") as HTMLElement; window.scrollTo(0, e.offsetTop + (e.offsetHeight - window.innerHeight) / 2); });
  expect(Math.abs((await lost.locator(".pin").boundingBox())?.y ?? 999)).toBeLessThan(2);
  await expect(lost.getByText("議論の途中で先生に届きます。")).toBeVisible();
  await expect(page.getByRole("heading", { name: /捉え方はちがっていた/ })).toBeAttached();
  await expect(page.getByRole("heading", { name: /教室全体の見取り図を/ })).toBeAttached();
  const faq = page.locator("#faq");
  await faq.getByText("どんな端末で使えますか？").click();
  await expect(faq.getByText(/インストールは不要です/)).toBeVisible();
  await faq.screenshot({ path: "../docs/screenshots/lp-faq-mobile.png" });
});

test("ログインと、これから使う教員・学校の申し込みの入口がある", async ({ page }) => {
  await page.goto("/lp");
  await expect(page.locator(".hero").getByRole("link", { name: "ログイン" })).toHaveAttribute("href", "/");
  const apply = page.getByRole("link", { name: "利用を申し込む" });
  await expect(apply).toHaveAttribute("href", /^mailto:contact@yuto-matsui\.com\?subject=/);
  await page.locator(".hero").getByRole("link", { name: "ログイン" }).click();
  await expect(page.getByRole("button", { name: "Googleでログイン", exact: true })).toBeVisible();
});
