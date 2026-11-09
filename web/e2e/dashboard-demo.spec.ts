import { expect, test, type Page } from "@playwright/test";
import { seedDashboardDemo } from "../../firebase/dashboard-demo.mjs";

async function capture(page: Page, scene: string, fullPage = true) {
  for (const [label, width, height] of [["small-phone", 320, 740], ["mobile", 390, 844], ["tablet", 820, 1180], ["tablet-landscape", 1024, 768], ["laptop", 1280, 800], ["desktop", 1440, 1000], ["wide", 1920, 1080], ["ultrawide", 2560, 1440]] as const) {
    await page.setViewportSize({ width, height });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width >= 1280) {
      const layout = fullPage ? page.locator(".teacher__body.live") : page.getByRole("dialog", { name: "グループ2", exact: true });
      const box = await layout.boundingBox();
      expect(box!.width).toBeGreaterThan(width * .9);
    }
    if (!fullPage) {
      const plot = page.locator('.session-group-sheet .speak-chart__plot > svg[role="img"]');
      await expect.poll(() => plot.evaluate(el => Math.abs(Number(el.getAttribute("width")) - el.parentElement!.clientWidth))).toBeLessThanOrEqual(2);
    }
    await page.screenshot({ path: `../docs/screenshots/session-host-demo-${scene}-${label}.png`, fullPage, animations: "disabled", scale: "css" });
  }
}

test("3グループのデモで発言割合・推移・詳細を確認し、続行と終了を操作できる", async ({ page }) => {
  await seedDashboardDemo();
  await page.goto("/demo/session");
  await page.getByRole("button", { name: "デモを開く", exact: true }).click();
  await expect(page).toHaveURL(/\/rooms\/dashboard-demo$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("学校でAIを使うとき、どんなルールが必要だろう？");
  await expect(page.getByRole("region", { name: "グループの状況" }).getByRole("button", { name: /グループ\dの詳細/ })).toHaveCount(3);
  await expect(page.getByRole("img", { name: "意見の検討率：60%", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "グループ2の詳細", exact: true })).toContainText("ひなた（デモ）");
  await capture(page, "dashboard");
  await page.getByRole("button", { name: "グループ2の詳細", exact: true }).click();
  const detail = page.getByRole("dialog", { name: "グループ2", exact: true });
  await expect(detail.getByRole("img", { name: /録音開始から10分まで/ })).toBeVisible();
  await expect(detail).toContainText("音声モックのテスト表示");
  await expect(detail).toContainText("ひなた（デモ）：391.0秒");
  await capture(page, "detail", false);
  await detail.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.getByRole("button", { name: "議論を終える", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "セッションを終了しますか？", exact: true });
  await confirmation.getByRole("button", { name: "続行する", exact: true }).click();
  await expect(page.getByRole("heading", { name: "セッション中", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "議論を終える", exact: true }).click();
  await confirmation.getByRole("button", { name: "終了する", exact: true }).click();
  await expect(page.getByRole("heading", { name: "セッションの結果", exact: true })).toBeVisible();
});
