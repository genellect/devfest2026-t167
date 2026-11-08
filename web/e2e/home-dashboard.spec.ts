import { expect, test, type Page } from "@playwright/test";
import { loginStudent } from "./student";

const sessions = [
  { sessionId: "home-ai", title: "生成AIとの付き合い方", theme: "生成AIとの付き合い方", className: "探究の授業", role: "participant", phase: "closed", ended: true, groupId: "2" },
  { sessionId: "home-city", title: "これからのまちづくり", theme: "これからのまちづくり", className: "社会", role: "participant", phase: "discussing", ended: false, groupId: "1" },
  { sessionId: "home-food", title: "食の未来を考える", theme: "食の未来を考える", className: "探究の授業", role: "participant", phase: "collecting", ended: false, groupId: "3" },
];
async function openSection(page: Page, name: string) {
  await page.getByRole("button", { name: "メニュー", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "ホームのメニュー", exact: true });
  const label = name === "すべての議論" ? "履歴" : name;
  await drawer.getByRole("button", { name: label, exact: true }).or(drawer.getByRole("link", { name: label, exact: true })).click();
  await expect(drawer).not.toBeVisible();
}
async function fixture(page: Page) {
  await page.route("**/api/discussions", (route) => route.fulfill({ json: { sessions } }));
}
test("文書をスクロールしてもバーは固定され、ブラウザ再読み込みで一覧を再取得する", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/discussions", async route => {
    requests++;
    await route.fulfill({ json: { sessions: Array.from({ length: 30 }, (_, i) => ({
      ...sessions[0], sessionId: `reload-${i}`, theme: `取得${requests}回目`,
    })) } });
  });
  await loginStudent(page);
  await openSection(page, "すべての議論");
  const list = page.getByRole("list", { name: "議論の履歴", exact: true });
  await expect(list.getByRole("listitem")).toHaveCount(30);
  const initialRequests = requests;
  await page.evaluate(() => window.scrollTo(0, 500));
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(300);
  expect((await page.getByRole("banner").boundingBox())!.y).toBe(0);
  await page.reload();
  await openSection(page, "すべての議論");
  await expect.poll(() => requests).toBeGreaterThan(initialRequests);
  await expect(list.getByRole("listitem").first()).toContainText(`取得${requests}回目`);
  await expect(page.getByText("下に引っ張って更新", { exact: true })).toHaveCount(0);
});
test("メニューから履歴を検索し、編集のない設定からログアウトできる", async ({ page }) => {
  await fixture(page); await loginStudent(page);
  await openSection(page, "すべての議論");
  const list = page.getByRole("list", { name: "議論の履歴", exact: true });
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await page.getByRole("searchbox", { name: "議論の履歴を検索" }).fill("まち");
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list).toContainText("これからのまちづくり");
  await page.getByRole("searchbox").fill("");
  await page.getByRole("searchbox").fill("探究の授業");
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await page.getByRole("searchbox").fill("");
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "プロフィール", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "保存する", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "ログアウト", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);

});
test("ホームの参加パネルは6桁コード・カメラ・Escapeでの復帰を維持する", async ({ page }) => {
  await fixture(page); await loginStudent(page);
  await page.goto("/join");
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByLabel("参加コード")).toHaveCount(0);
  await page.getByRole("button", { name: "参加する", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "議論に参加する" });
  await expect(dialog.getByLabel("参加コード")).toBeFocused();
  await dialog.getByLabel("参加コード").fill("１２３４５６");
  await expect(dialog.getByLabel("参加コード")).toHaveValue("123456");
  await expect(dialog.getByRole("button", { name: "カメラで読み取る" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "参加する", exact: true })).toBeFocused();
  await expect(page.getByRole("link", { name: "議論を作る", exact: true })).toHaveCount(0);
});
test("ホームは開始ボタンと任意のClassroom連携を各画面幅で表示する", async ({ browser, baseURL }) => {
  for (const [name, width, height, touch] of [["desktop", 1440, 960, false], ["phone", 393, 852, true], ["tablet", 1180, 820, true], ["tablet-wide", 1366, 1024, true], ["small", 320, 568, true]] as const) {
    const context = await browser.newContext({ baseURL, viewport: { width, height }, hasTouch: touch, isMobile: touch });
    try {
      const page = await context.newPage(); await fixture(page); await loginStudent(page, name);
      const main = page.getByRole("main");
      await expect(main.getByRole("searchbox")).toHaveCount(0);
      await expect(main.getByRole("combobox")).toHaveCount(0);
      await expect(main.getByRole("list")).toHaveCount(0);
      await expect(main.getByText("LET’S THINK TOGETHER", { exact: true })).toHaveCount(0);
      await expect(main.getByRole("heading", { name: "次のわたしへ", exact: true })).toHaveCount(0);
      await expect(main.getByRole("region", { name: "議論の開始" }).getByRole("button")).toHaveCount(1);
      await expect(main.getByRole("button", { name: "Classroomと連携", exact: true })).toHaveCount(1);
      await expect(main.getByRole("region", { name: "議論の開始" }).getByRole("link")).toHaveCount(1);
      const navigation = page.getByRole("navigation", { name: "下部メニュー" });
      await expect(navigation).toHaveCount(0);
      const menu = page.getByRole("button", { name: "メニュー", exact: true });
      await expect(menu).toBeVisible();
      await menu.click();
      await expect(page.getByRole("dialog", { name: "ホームのメニュー", exact: true })).toBeVisible();
      const drawer = page.getByRole("dialog", { name: "ホームのメニュー", exact: true });
      await expect(drawer.getByRole("heading", { name: "Tops", exact: true })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(drawer.getByRole("link", { name: "ホーム", exact: true })).toBeFocused();
      await expect(drawer.getByRole("link", { name: "ホーム", exact: true })).toHaveCSS("outline-style", "solid");
      await expect(drawer.getByRole("button", { name: "メニューを閉じる" })).toHaveCount(0);
      await expect(drawer.getByRole("button", { name: /参加/ })).toHaveCount(0);
      await expect(drawer).toHaveCSS("border-top-left-radius", "0px");
      await expect(drawer.getByRole("link", { name: "ホーム", exact: true })).toHaveCSS("border-top-left-radius", "0px");
      await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");
      await page.keyboard.press("Escape");
      await expect(drawer).toHaveAttribute("data-closing", "true");
      await expect(drawer).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");
      await expect(drawer).not.toBeVisible();
      await expect(menu).toBeFocused();
      const join = page.getByRole("button", { name: "参加する", exact: true });
      const host = page.getByRole("link", { name: "ホストする", exact: true });
      await page.mouse.move(0, 0);
      await expect(join).toHaveCSS("background-color", "rgb(11, 87, 208)");
      await expect(host).toHaveAttribute("href", "/host/new");
      const joinBox = (await join.boundingBox())!, hostBox = (await host.boundingBox())!;
      expect(Math.abs(joinBox.height - hostBox.height), `${name}: same height`).toBeLessThan(1);
      expect(Math.abs(joinBox.width - hostBox.width), `${name}: same width`).toBeLessThan(1);
      expect(hostBox.y, `${name}: host below join`).toBeGreaterThanOrEqual(joinBox.y + joinBox.height);
      // カードの隅も参加ボタンとして動く。
      await join.click({ position: { x: 8, y: 8 } });
      await expect(page.getByRole("dialog", { name: "議論に参加する" })).toBeVisible();
      await page.keyboard.press("Escape");
      await page.mouse.move(0, 0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name).toBe(true);
      await expect.poll(() => page.locator("img:visible").evaluateAll((imgs) => imgs.every((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0))).toBe(true);
      await page.screenshot({ path: `../docs/screenshots/responsive-home-${name}.png`, fullPage: !touch });
    } finally { await context.close(); }
  }
});
