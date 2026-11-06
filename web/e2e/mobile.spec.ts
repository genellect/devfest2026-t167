import { expect, test } from "@playwright/test";
import { loginStudent } from "./student";
for (const [account, landing, home] of [["生徒", /\/join$/, "/home"], ["先生", /\/teacher$/, "/teacher"]] as const) {
  test(`${account}の模擬アカウントは役割登録せず、ログイン後に${account === "生徒" ? "参加コードの入力" : "教員のホーム"}へ進む`, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: `テスト用の${account}でログイン（エミュレータ）` }).click();
    await expect(page).toHaveURL(landing);
    // 学生には作成の入口を出さない。教員のホームの主役は作成
    if (account === "生徒") await expect(page.getByRole("link", { name: /ディスカッションを作る/ })).toHaveCount(0);
    else await expect(page.getByRole("link", { name: "ディスカッションを作る", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const path of ["/home", "/host/new", "/join", "/host/profile", "/about"]) {
      await page.goto(path);
      const tabs = page.getByRole("navigation", { name: "メニュー" }).getByRole("link");
      await expect(tabs).toHaveText(["ホーム", "参加", "アカウント"]);
      await expect(tabs.first()).toHaveAttribute("href", home);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path).toBe(true);
    }
  });
}
test("参加コードは数字だけを受け付け、全角の数字も半角にそろえる", async ({ page }) => {
  await loginStudent(page); await page.goto("/join");
  await page.getByLabel("参加コード").fill("12-3 ４５６a");
  await expect(page.getByLabel("参加コード")).toHaveValue("123456");
  await expect(page.getByRole("button", { name: "参加する" })).toBeEnabled();
});
