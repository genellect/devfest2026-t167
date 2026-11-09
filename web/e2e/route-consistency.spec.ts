import { expect, test } from "@playwright/test";
import { loginStudent } from "./student";

test("共通画面と旧URLをスマホ・タブレット・PCで操作できる", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await loginStudent(page, "route-audit", { home: false });
  await expect(page).toHaveURL(/\/home$/);
  for (const [old, current] of [["/teacher", "/home"], ["/student", "/home"], ["/host", "/home"], ["/signup", "/home"], ["/host/profile", "/settings"], ["/participate", "/join"]]) {
    await page.goto(old);
    await expect(page).toHaveURL(new RegExp(`${current}$`));
  }
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of ["/home", "/history", "/settings", "/sessions", "/about", "/lp", "/join", "/host/new"]) {
      await page.goto(route);
      await expect(page.getByRole("main")).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width !== 820) await page.screenshot({ path: `../docs/screenshots/blue-${route.slice(1).replaceAll("/", "-")}-${width}.png`, animations: "disabled", scale: "css" });
    }
  }
  expect(errors).toEqual([]);
});
