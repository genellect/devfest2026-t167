import { expect, test } from "@playwright/test";
import { LP_MEASUREMENT_ID, LP_URL, SITE_ORIGIN } from "../src/lib/lp-config";

test("確認タグ・canonical・LPだけのサイトマップを公開し、ローカルではGA4を読まない", async ({ page, request }) => {
  let googleTags = 0;
  page.on("request", r => { if (r.url().includes("googletagmanager.com/gtag/")) googleTags++; });
  await page.goto("/lp?email=private%40example.org");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", LP_URL);
  await expect(page.locator('meta[name="google-site-verification"]')).toHaveAttribute("content", "KzMtX0b7Jaqx9WR8lM1iGJVVMapcqk56eKgTiiMgnRs");
  await expect(page.locator(".hero h1")).toBeVisible();
  expect(googleTags).toBe(0);
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  expect((await sitemap.text()).match(/<loc>/g)).toHaveLength(1);
  expect(await sitemap.text()).toContain(`<loc>${LP_URL}</loc>`);
  expect(await (await request.get("/robots.txt")).text()).toContain(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`);
  await page.goto("/");
  await expect(page.locator('meta[name="google-site-verification"]')).toHaveAttribute("content", "KzMtX0b7Jaqx9WR8lM1iGJVVMapcqk56eKgTiiMgnRs");
});

test("本番LPでページビューを1回、CTAを計測し、個人情報を送らずアプリへ持ち越さない", async ({ page, baseURL }) => {
  // 本番 origin の画面を手元のビルドで応答し、Googleのタグはスタブにする。実GAへは送信しない。
  await page.route(`${SITE_ORIGIN}/**`, async route => {
    const url = new URL(route.request().url());
    await route.fulfill({ response: await route.fetch({ url: `${baseURL}${url.pathname}${url.search}` }) });
  });
  let googleTags = 0;
  await page.route("https://www.googletagmanager.com/**", async route => {
    googleTags++;
    await route.fulfill({ contentType: "application/javascript", body: "/* GA4 network stub */" });
  });
  await page.goto(`${LP_URL}?email=private%40example.org#private`, { referer: "https://example.org/private?code=123456" });
  const events = () => page.evaluate(() => {
    const w = window as Window & { dataLayer?: Array<IArguments> };
    return (w.dataLayer ?? []).map(value => Array.from(value));
  });
  await expect.poll(async () => (await events()).filter(e => e[1] === "page_view").length).toBe(1);
  await expect.poll(() => googleTags).toBe(1);
  const initial = await events();
  expect(initial[0]).toEqual(["set", expect.objectContaining({ send_page_view: false, page_location: LP_URL, page_referrer: "https://example.org/", allow_google_signals: false, allow_ad_personalization_signals: false })]);
  expect(initial.find(e => e[0] === "config")).toEqual(["config", LP_MEASUREMENT_ID]);
  expect(JSON.stringify(initial)).not.toMatch(/private|123456|email=/);
  // メールアプリは開かず、同じクリックイベントだけを実際のリンクで確かめる。
  await page.locator('.hero a[data-lp-action="apply"]').evaluate(el => el.addEventListener("click", e => e.preventDefault(), { once: true }));
  await page.locator('.hero a[data-lp-action="apply"]').click();
  await expect.poll(async () => (await events()).filter(e => e[1] === "lp_cta_click").length).toBe(1);
  expect((await events()).find(e => e[1] === "lp_cta_click")).toEqual(["event", "lp_cta_click", expect.objectContaining({ cta_action: "apply", cta_placement: "hero", page_location: LP_URL })]);
  expect(JSON.stringify(await events())).not.toMatch(/mailto:|contact@|private|123456/);
  // リンクが文書を切り替えるため、LP の SDK とキューはログイン画面に残らない。
  await page.locator('.hero a[href="/"]').click();
  await expect(page.getByRole("button", { name: "Googleでログイン", exact: true })).toBeVisible();
  expect(await events()).toEqual([]);
  expect(googleTags).toBe(1);
  await page.addInitScript(() => { Object.assign(window, { "ga-disable-G-YEDJKQME2G": true }); });
  await page.goto(LP_URL);
  await expect(page.locator(".hero h1")).toBeVisible();
  expect(await events()).toEqual([]);
  expect(googleTags).toBe(1);
});
