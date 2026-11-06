import { expect, test } from "@playwright/test";
import { loginStudent } from "./student";
for (const account of ["生徒", "先生"]) {
  test(`${account}の模擬アカウントも役割登録せず共通ホームを利用する`, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: `テスト用の${account}でログイン（エミュレータ）` }).click();
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole("heading", { name: "あなたのホーム" })).toBeVisible();
    // 参加のカードはホームに直接ある
    await expect(page.getByLabel("参加コード")).toBeVisible();
    await expect(page.getByRole("link", { name: "議論を作る", exact: true })).toBeVisible();
    for (const path of ["/home", "/host/new", "/join", "/host/profile", "/about"]) {
      await page.goto(path);
      // スマホではメニューを「≡」で開く
      await page.getByRole("button", { name: "メニュー", exact: true }).click();
      await expect(page.getByRole("navigation", { name: "メニュー" }).getByRole("link")).toHaveText(["ホーム", "設定"]);
      await page.keyboard.press("Escape");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path).toBe(true);
    }
  });
}
test("参加コードは数字だけを受け付け、全角の数字も半角にそろえる", async ({ page }) => {
  await loginStudent(page); await page.goto("/join");
  await page.getByLabel("参加コード").fill("12-3 ４５６a");
  await expect(page.getByLabel("参加コード")).toHaveValue("123456");
  await expect(page.getByRole("button", { name: "参加する", exact: true })).toBeEnabled();
});
