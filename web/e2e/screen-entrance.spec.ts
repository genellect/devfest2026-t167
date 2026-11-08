import { expect, test } from "@playwright/test";
import { loginGoogle } from "./google";

for (const mode of ["native", "fallback", "reduced"] as const) {
  test.describe(`下からの画面表示: ${mode}`, () => {
    test.use({ reducedMotion: mode === "reduced" ? "reduce" : "no-preference" });
    test("参加入力・ホストへの遷移と、アニメーション終了後の操作を維持する", async ({ page }) => {
      if (mode === "fallback") await page.addInitScript(() => {
        Object.defineProperty(document, "startViewTransition", { value: undefined, configurable: true });
      });
      await page.goto("/");
      await loginGoogle(page, "teacher", `motion-${mode}`);
      await expect(page).toHaveURL(/\/home$/);
      await page.getByRole("button", { name: "参加する", exact: true }).click();
      const join = page.getByRole("dialog", { name: "議論に参加する", exact: true });
      await expect(join).toBeVisible();
      if (mode === "reduced") await expect(join).toHaveCSS("animation-name", "none");
      else {
        const offsets = await join.evaluate(element => {
          const animation = element.getAnimations().find(a => a instanceof CSSAnimation && a.animationName.includes("homeJoinRise"))!;
          animation.pause();
          const positions = [0, 200, 400].map(time => {
            animation.currentTime = time;
            return new DOMMatrix(getComputedStyle(element).transform).m42;
          });
          animation.finish();
          return positions;
        });
        expect(offsets[0]).toBeGreaterThan(500);
        expect(offsets[1]).toBeGreaterThan(0);
        expect(offsets[1]).toBeLessThan(offsets[0]);
        expect(offsets[2]).toBe(0);
      }
      await expect(join.getByLabel("参加コード")).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(join).not.toBeVisible();
      await expect(page.getByRole("button", { name: "参加する", exact: true })).toBeFocused();

      if (mode === "native") await page.evaluate(() => {
        const original = document.startViewTransition.bind(document);
        document.startViewTransition = update => {
          const transition = original(update);
          void transition.ready.then(() => {
            const animation = document.getAnimations().find(a => a instanceof CSSAnimation && a.animationName === "discussScreenRise")!;
            animation.pause(); animation.currentTime = 100;
            (window as Window & { screenAnimation?: Animation }).screenAnimation = animation;
          });
          return transition;
        };
      });
      await page.getByRole("link", { name: "ホストする", exact: true }).click();
      await expect(page).toHaveURL(/\/host\/new$/);
      if (mode === "native") {
        await expect.poll(() => page.evaluate(() => !!(window as Window & { screenAnimation?: Animation }).screenAnimation)).toBe(true);
        expect(await page.evaluate(() => new DOMMatrix(getComputedStyle(document.documentElement, "::view-transition-new(root)").transform).m42)).toBeGreaterThan(0);
        await page.evaluate(() => (window as Window & { screenAnimation?: Animation }).screenAnimation!.finish());
        await expect.poll(() => page.evaluate(() => document.documentElement.dataset.risingScreen)).toBe(undefined);
        // 背面のホームを使う遷移が終わっても、代替CSSアニメーションを二度目に再生しない。
        await expect(page.locator("[data-screen-entrance]")).toHaveCSS("animation-name", "none");
      } else {
        await expect(page.locator("[data-screen-entrance]")).toHaveCSS("animation-name", mode === "reduced" ? "none" : /screenRise/);
      }
      await expect(page.getByLabel("テーマ", { exact: true })).toBeVisible();
      await page.getByLabel("テーマ", { exact: true }).fill("アニメーション後も入力できる");
      await expect(page.getByLabel("テーマ", { exact: true })).toHaveValue("アニメーション後も入力できる");
      await page.getByRole("link", { name: "ホームへ戻る", exact: true }).click();
      await expect(page).toHaveURL(/\/home$/);
    });
  });
}
