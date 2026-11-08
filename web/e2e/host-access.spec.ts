import { expect, test } from "@playwright/test";
import { loginStudent } from "./student";
import { mkdir } from "node:fs/promises";

for (const [name, width, height] of [["phone", 390, 844], ["tablet-portrait", 820, 1180], ["tablet-landscape", 1180, 820], ["desktop", 1440, 900]] as const) {
  test(`共通ホームの同サイズ・中央配置・Googleログイン済み利用者のホスト入口 ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await loginStudent(page);
    const join = page.getByRole("button", { name: "参加する", exact: true });
    const host = page.getByRole("link", { name: "ホストする", exact: true });
    await expect(join).toBeVisible(); await expect(host).toBeVisible();
    const a = await join.boundingBox(), b = await host.boundingBox();
    expect(a).not.toBeNull(); expect(b).not.toBeNull();
    expect(Math.abs(a!.width - b!.width)).toBeLessThan(1);
    expect(Math.abs(a!.height - b!.height)).toBeLessThan(1);
    for (const button of [join, host]) {
      const box = await button.boundingBox(), label = await button.locator("span").first().boundingBox();
      expect(Math.abs(box!.x + box!.width / 2 - label!.x - label!.width / 2)).toBeLessThan(1);
      expect(Math.abs(box!.y + box!.height / 2 - label!.y - label!.height / 2)).toBeLessThan(1);
      const font = await button.locator("span").first().evaluate(e => Number.parseFloat(getComputedStyle(e).fontSize));
      expect(font).toBeGreaterThanOrEqual(22); expect(font).toBeLessThanOrEqual(28);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await mkdir("../artifacts/open-host", { recursive: true });
    await page.screenshot({ path: `../artifacts/open-host/${test.info().project.name}-${name}.png`, fullPage: true });
    await host.click(); await expect(page.getByLabel("テーマ", { exact: true })).toBeVisible();
  });
}

test("教師claimがなくてもClassroomのコース教師ならクラス付き作成の入口を表示する", async ({ page }) => {
  test.skip(process.env.NEXT_PUBLIC_CLASSROOM_MOCK !== "1", "Classroomの明示モック環境で検証する");
  await loginStudent(page);
  // Googleのコース所属だけを模擬し、アプリのteacher claimには触れない。
  await page.route("**/api/integrations/classroom/courses", route => route.fulfill({ json: {
    courses: [{ id: "mock-class-1", name: "コースの教師", role: "teacher" }], syncedAt: Date.now(),
  } }));
  await page.getByRole("button", { name: "Classroomと連携", exact: true }).click();
  const link = page.getByRole("link", { name: "このクラスでホストする", exact: true });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.getByLabel("テーマ", { exact: true })).toBeVisible();
});

test("旧ホームURLの参加リンクは共通ホームに引き継ぐ", async ({ page }) => {
  await loginStudent(page);
  await page.goto("/teacher?join=1");
  await expect(page).toHaveURL(/\/home\?join=1$/);
  await expect(page.getByRole("dialog", { name: "議論に参加する", exact: true })).toBeVisible();
});
