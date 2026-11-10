import { expect, test } from "@playwright/test";

// 紹介ページ（LP）：ログインなしで開け、AI 時代に育てたい力と3機能を示し、ログインと利用の申し込みの入口がある。
// 8グループの場面・学習指導要領・よくある質問・開発者の紹介も読める。

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
  await expect(page.getByRole("heading", { name: "答えは、AI が出せるようになった。" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "考えることを、AI に任せない教室へ。" })).toBeVisible();
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

test("教員が聞けなかったグループで起きていたことを、3機能の結果として読める", async ({ page }) => {
  await page.goto("/lp");
  const rooms = page.locator("#rooms");
  await expect(rooms.getByRole("heading", { name: /8つの議論のうち1つ/ })).toBeAttached();
  await expect(rooms.getByRole("listitem")).toHaveCount(8);
  for (const label of ["未検討の論点", "発言率", "考えの変化"]) await expect(rooms.getByText(label, { exact: true }).first()).toBeAttached();
  await rooms.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await rooms.screenshot({ path: "../docs/screenshots/lp-rooms-mobile.png" });
});

test("学習指導要領との関係とよくある質問を、出典つきで読める", async ({ page }) => {
  await page.goto("/lp");
  const cg = page.locator("#guideline");
  await expect(cg.getByRole("heading", { name: "「主体的・対話的で深い学び」の実装" })).toBeAttached();
  await expect(cg.getByText(/次期学習指導要領等に向けた審議まとめ/)).toBeAttached();
  const faq = page.locator("#faq");
  await faq.getByText("事前に書いた意見は、ほかの人に見られますか？").click();
  await expect(faq.getByText(/書いた本人にしか表示されません/)).toBeVisible();
});

test("ヘッダーの About the Developers から、吹き出しで開発者のポートフォリオへ進める", async ({ page }) => {
  await page.goto("/lp");
  const pop = page.locator("#lp-devs");
  await expect(pop).toBeHidden();
  await page.locator(".lp-nav").getByRole("button", { name: "About the Developers" }).click();
  await expect(pop).toBeVisible();
  await expect(pop.getByRole("link", { name: /Yuto Matsui/ })).toHaveAttribute("href", "https://yuto-matsui.com/");
  await expect(pop.getByRole("link", { name: /Koyuri Yamashita/ })).toHaveAttribute("href", /student\.redesigner\.jp\/students\//);
  await expect(pop.getByText("Ryota Murakami")).toBeVisible();
  // LP の本文には載せない
  await expect(page.locator("main").getByText("Yuto Matsui")).toHaveCount(0);
  await page.screenshot({ path: "../docs/screenshots/lp-developers-mobile.png", clip: { x: 0, y: 0, width: 412, height: 340 } });
  await page.keyboard.press("Escape");
  await expect(pop).toBeHidden();
});
