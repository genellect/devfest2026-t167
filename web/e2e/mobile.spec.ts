import { loginGoogle } from "./google";
import { expect, test } from "@playwright/test";
import { loginStudent } from "./student";
for (const [account, landing, home] of [["生徒", /\/home$/, "/home"], ["先生", /\/home$/, "/home"]] as const) {
  test(`${account}の模擬アカウントは役割登録せず、ログイン後に共通ホームへ進む`, async ({ page }) => {
    await page.goto("/");
    await loginGoogle(page, account === "先生" ? "teacher" : "student");
    await expect(page).toHaveURL(landing);
    // Googleログイン済み全員に同じ作成入口を表示する。
    await expect(page.getByRole("link", { name: "ホストする", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (account === "生徒") {
      // 学生のホームには参加のカードを直接置く
      await page.goto("/home");
      await expect(page.getByRole("heading", { name: "あなたのホーム" })).toBeVisible();
      await page.getByRole("button", { name: "参加する", exact: true }).click();
      await expect(page.getByRole("dialog").getByLabel("参加コード")).toBeVisible();
      await page.getByRole("button", { name: "参加画面を閉じる" }).click();
    }
    for (const path of ["/home", "/host/new", "/join", "/settings", "/about"]) {
      await page.goto(path);
      // 設定は右上のアカウントではなく共通サイドバーから開く。
      if (path === "/home" || path === "/join") {
        await expect(page.getByRole("button", { name: "Gemini 話し合うテーマを考える" })).toBeVisible();
        await expect(page.getByRole("button", { name: "メニュー", exact: true })).toBeVisible();
      } else if (path === "/host/new") {
        await expect(page.getByRole("link", { name: "ホームへ戻る", exact: true })).toHaveAttribute("href", home);
        await expect(page.getByLabel("セッション名", { exact: true })).toHaveValue("無題のセッション");
      }
      if (path !== "/host/new") {
        await expect(page.getByRole("link", { name: /^設定（/ })).toHaveCount(0);
        await page.getByRole("button", { name: "メニュー", exact: true }).click();
        const menu = page.getByRole("dialog", { name: "ホームのメニュー", exact: true });
        await expect(menu.getByRole("link")).toHaveText(["ホーム", "履歴", "設定"]);
        await expect(menu.getByRole("link", { name: "ホーム", exact: true })).toHaveAttribute("href", home);
        await expect(menu.getByRole("link", { name: "設定", exact: true })).toHaveAttribute("href", "/settings");
        await page.keyboard.press("Escape"); await expect(menu).not.toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path).toBe(true);
    }
  });
}
test("参加コードは数字だけを受け付け、全角の数字も半角にそろえる", async ({ page }) => {
  await loginStudent(page);
  await page.getByRole("button", { name: "参加する", exact: true }).click();
  await page.getByLabel("参加コード").fill("12-3 ４５６a");
  await expect(page.getByLabel("参加コード")).toHaveValue("123456");
  await expect(page.getByRole("dialog").getByRole("button", { name: "参加する", exact: true })).toBeEnabled();
});
