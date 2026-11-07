import { expect, test } from "@playwright/test";
import { loginStudent } from "./student";
for (const [account, landing, home] of [["生徒", /\/join$/, "/home"], ["先生", /\/teacher$/, "/teacher"]] as const) {
  test(`${account}の模擬アカウントは役割登録せず、ログイン後に${account === "生徒" ? "参加コードの入力" : "教員のホーム"}へ進む`, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: `テスト用の${account}でログイン（エミュレータ）` }).click();
    await expect(page).toHaveURL(landing);
    // 学生には作成の入口を出さない。教員のホームの主役は作成
    if (account === "生徒") await expect(page.getByRole("link", { name: /議論を作る/ })).toHaveCount(0);
    else await expect(page.getByRole("link", { name: "議論を作る", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (account === "生徒") {
      // 学生のホームには参加のカードを直接置く
      await page.goto("/home");
      await expect(page.getByRole("heading", { name: "あなたのホーム" })).toBeVisible();
      await expect(page.getByLabel("参加コード")).toBeVisible();
    }
    for (const path of ["/home", "/host/new", "/join", "/host/profile", "/about"]) {
      await page.goto(path);
      // スマホではメニューを「≡」で開く。ホームは教員なら教員のホーム、学生なら学生のホーム
      await page.getByRole("button", { name: "メニュー", exact: true }).click();
      const links = page.getByRole("navigation", { name: "メニュー" }).getByRole("link");
      await expect(links).toHaveText(["ホーム", "設定"]);
      await expect(links.first()).toHaveAttribute("href", home);
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
