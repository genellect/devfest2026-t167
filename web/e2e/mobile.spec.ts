import { expect, test } from "@playwright/test";
import { loginStudent } from "./student";
for (const account of ["生徒", "先生"] as const) {
  test(`${account}は共通ホームを使い、サーバーの権限に従って操作できる`, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: `テスト用の${account}でログイン（エミュレータ）`, includeHidden: true }).evaluate(element => (element as HTMLButtonElement).click());
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole("heading", { name: "あなたのホーム", exact: true })).toBeVisible();
    // 議論を作れるのは教員だけ（Figma 02-T）。学生のホームは参加が主役（02-S）
    const host = page.getByRole("link", { name: "議論を作る", exact: true });
    if (account === "生徒") { await expect(host).toHaveCount(0); await expect(page.getByLabel("参加コード")).toBeVisible(); }
    else await expect(host).toBeVisible();
    for (const path of ["/home", "/host/new", "/join", "/host/profile", "/about"]) {
      await page.goto(path);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path).toBe(true);
    }
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "設定", exact: true })).toBeVisible();
  });
}
test("参加コードは数字だけを受け付け、全角の数字も半角にそろえる", async ({ page }) => {
  await loginStudent(page); await page.goto("/join");
  await page.getByLabel("参加コード").fill("12-3 ４５６a");
  await expect(page.getByLabel("参加コード")).toHaveValue("123456");
  await expect(page.getByRole("button", { name: "参加する", exact: true })).toBeEnabled();
});
