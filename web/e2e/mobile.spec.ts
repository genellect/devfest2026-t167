import { expect, test, type Page } from "@playwright/test";
import { loginStudent } from "./student";

// スマホの幅（playwright.config.ts の mobile プロジェクト）で、ホーム・参加・使い方などの画面が横にはみ出さず、
// 画面の下に固定したタブメニューに、役割に合ったタブが出ること。

async function expectNoHorizontalScroll(page: Page, label: string) {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  expect(scroll, `${label} の横幅`).toBeLessThanOrEqual(width);
}

/** タブの並びと、いまの画面のタブ（aria-current）。スマホでは画面の下に固定し、どのタブも高さ 44px 以上 */
async function expectTabs(page: Page, labels: string[], current: string) {
  const nav = page.getByRole("navigation", { name: "メニュー" });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link")).toHaveText(labels);
  await expect(nav.getByRole("link", { name: current, exact: true })).toHaveAttribute("aria-current", "page");
  await expect(nav.locator("[aria-current]")).toHaveCount(1);
  const box = (await nav.boundingBox())!;
  expect(Math.abs(box.y + box.height - page.viewportSize()!.height), "タブメニューが画面の下にある").toBeLessThan(2);
  for (const link of await nav.getByRole("link").all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
}

const STUDENT_TABS = ["ホーム", "参加", "使い方"];
const HOST_TABS = ["ホーム", "部屋を作る", "使い方", "設定"];

test("スマホの幅で、参加と使い方の画面に生徒のタブが出て、横にはみ出さない", async ({ page }) => {
  await loginStudent(page);
  await page.getByRole("link", { name: "参加コードを入力", exact: true }).click();
  await expectTabs(page, STUDENT_TABS, "参加");
  await expectNoHorizontalScroll(page, "/join");
  // 6マスの入力欄は1つの入力欄として動く（貼り付けた小文字・記号もそろえる）
  await page.getByLabel("参加コード").fill("ab-12 cd");
  await expect(page.getByLabel("参加コード")).toHaveValue("AB12CD");
  await expect(page.getByRole("button", { name: "参加する" })).toBeEnabled();

  await page.getByRole("navigation", { name: "メニュー" }).getByRole("link", { name: "使い方" }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expectTabs(page, STUDENT_TABS, "使い方");
  await expectNoHorizontalScroll(page, "/about");
});

test("テスト用の生徒でログインすると、生徒のホームにタブが出て、横にはみ出さない", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "テスト用の生徒でログイン（エミュレータ）" }).click();
  await page.getByRole("button", { name: /^生徒/ }).click();
  await expect(page).toHaveURL(/\/student$/);
  await expect(page.getByRole("heading", { name: "あなたのホーム" })).toBeVisible();
  await expectTabs(page, STUDENT_TABS, "ホーム");
  await expectNoHorizontalScroll(page, "/student");
});

test("テスト用の先生でログインすると、先生の画面にタブが出て、横にはみ出さない", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "テスト用の先生でログイン（エミュレータ）" }).click();
  await page.getByRole("button", { name: /^先生/ }).click();
  await page.getByLabel("表示する名前").fill("テスト先生");
  await page.getByRole("button", { name: "登録してはじめる" }).click();
  await expect(page).toHaveURL(/\/host$/);
  await expect(page.getByRole("heading", { name: "テスト先生のホーム" })).toBeVisible();
  await expectTabs(page, HOST_TABS, "ホーム");
  await expectNoHorizontalScroll(page, "/host");

  const nav = page.getByRole("navigation", { name: "メニュー" });
  for (const [tab, path] of [["部屋を作る", "/host/new"], ["設定", "/host/profile"], ["使い方", "/about"]] as const) {
    await nav.getByRole("link", { name: tab }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expectTabs(page, HOST_TABS, tab); // 使い方の画面でも、先生には先生のタブを出す
    await expectNoHorizontalScroll(page, path);
  }
});
