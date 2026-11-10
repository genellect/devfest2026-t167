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

test("8グループの場面を最後まで進めると、授業のあとに全グループの結果が見える", async ({ page }) => {
  await page.goto("/lp");
  const scene = page.locator(".sc--rooms");
  await scene.scrollIntoViewIfNeeded();
  await page.evaluate(() => { const e = document.querySelector(".sc--rooms") as HTMLElement; window.scrollTo(0, e.offsetTop + e.offsetHeight - window.innerHeight); });
  await expect(scene.getByText("8つすべての議論に目を向けられる。", { exact: false })).toBeVisible();
  await expect(scene.getByText("未検討の論点が1つ")).toBeVisible();
  // 場面は画面に貼り付いたまま（position: sticky が効く）
  expect(Math.abs((await scene.locator(".sc__stick").boundingBox())?.y ?? 999)).toBeLessThan(2);
  await scene.locator(".sc__stick").screenshot({ path: "../docs/screenshots/lp-rooms-mobile.png" });
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

test("ヘッダーの About the Developers から、開発者とポートフォリオへ進める", async ({ page }) => {
  await page.goto("/lp");
  await page.locator(".lp-nav").getByRole("link", { name: "About the Developers" }).click();
  const devs = page.locator("#developers");
  await expect(devs.getByRole("heading", { name: "About the Developers" })).toBeInViewport();
  await expect(devs.getByRole("link", { name: /Yuto Matsui/ })).toHaveAttribute("href", "https://yuto-matsui.com/");
  await expect(devs.getByRole("link", { name: /Koyuri Yamashita/ })).toHaveAttribute("href", /student\.redesigner\.jp\/students\//);
  await expect(devs.getByText("Ryota Murakami")).toBeVisible();
  await devs.screenshot({ path: "../docs/screenshots/lp-developers-mobile.png" });
});
