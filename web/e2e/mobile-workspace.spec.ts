import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { emulatorGoogleUser } from "../../firebase/emulator-auth.mjs";

test.beforeEach(async ({ page }, info) => {
  const subject = `workspace-${createHash("sha256").update(`${info.testId}:${info.retry}`).digest("hex").slice(0, 24)}`;
  await emulatorGoogleUser("teacher", subject);
  await page.route(/identitytoolkit.*accounts:signInWithIdp/, async route => {
    const data = route.request().postDataJSON();
    const body = new URLSearchParams(data.postBody);
    const token = JSON.parse(body.get("id_token") ?? "{}");
    body.set("id_token", JSON.stringify({ ...token, sub: subject, email: `${subject}@example.com` }));
    await route.continue({ postData: JSON.stringify({ ...data, postBody: body.toString() }) });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "テスト用の先生でログイン（エミュレータ）", includeHidden: true }).evaluate(element => (element as HTMLButtonElement).click());
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("heading", { name: "マイダッシュボード" })).toBeVisible();
  await expect(page.getByText("プレビューユーザーさん、こんにちは。")).toHaveCount(0);
  await expect(page.getByText("参加した議論や振り返りが、ここに並びます。")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "次の目標" })).toHaveCount(0);
});

test("サイドメニューで履歴と設定へ進み、Geminiのテーマ案を作成画面へ引き継ぐ", async ({ page }) => {
  await page.getByRole("button", { name: "メニューを開く" }).click();
  await page.getByRole("navigation").getByRole("link", { name: "履歴", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "メニュー", exact: true })).not.toBeVisible();
  await expect(page.locator("header").getByRole("textbox", { name: "履歴を検索" })).toBeVisible();
  await expect(page.locator("header").getByText("Geminiでテーマを考える")).toHaveCount(0);
  const search = page.getByRole("textbox", { name: "履歴を検索" });
  await expect(search).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await search.fill("一致しない検索");
  await expect(search).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(search).toHaveCSS("box-shadow", "none");
  await expect(page.locator("header")).toHaveCSS("background-color", "rgb(241, 243, 246)");
  await expect(page.getByRole("heading", { name: "一致する議論はありません" })).toBeVisible();
  await page.getByRole("button", { name: "メニューを開く" }).click();
  await page.getByRole("navigation").getByRole("link", { name: "アカウント・設定" }).click();
  await expect(page.getByRole("link", { name: "端末とセッション", exact: true })).toBeVisible();
  await expect(page.locator("header").getByRole("button")).toHaveCount(1);
  await expect(page.locator("header").getByRole("link")).toHaveCount(0);
  await page.goto("/home");
  await page.getByRole("button", { name: "Geminiでテーマを考える", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "どんなことを話し合いたい？" })).not.toBeFocused();
  await page.getByRole("textbox", { name: "どんなことを話し合いたい？" }).fill("学校でのAIの使い方");
  const response = page.waitForResponse(reply => reply.url().includes("/api/themes/suggest") && reply.request().method() === "POST");
  await page.getByRole("button", { name: "テーマを提案してもらう", exact: true }).click();
  const { themes } = await (await response).json() as { themes: string[] };
  await page.getByRole("button", { name: themes[0], exact: true }).click();
  await expect(page.getByLabel("テーマ", { exact: true })).toHaveValue(themes[0]);
  await page.goto("/settings");
  await page.getByRole("button", { name: "ログアウト", exact: true }).click();
  await expect(page.getByRole("button", { name: "Googleでログイン", exact: true })).toBeVisible();
  await expect(page.getByText(/ログインし直してください/)).toHaveCount(0);
});

test("メニューを端からのスワイプで開閉でき、動きを減らす設定でも操作できる", async ({ page }) => {
  const icon = page.locator("header img");
  await expect(icon).toBeVisible();
  await expect.poll(() => icon.evaluate(node => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0)).toBe(true);
  const dialog = page.getByRole("dialog", { name: "メニュー", exact: true });
  await page.mouse.move(8, 300);
  await page.mouse.down();
  await page.mouse.move(190, 300, { steps: 12 });
  await page.mouse.up();
  await expect(dialog).toBeVisible();
  await page.mouse.move(240, 500);
  await page.mouse.down();
  await page.mouse.move(90, 500, { steps: 12 });
  await page.mouse.up();
  await expect(dialog).not.toBeVisible();
  const refreshed = page.waitForResponse(reply => reply.url().includes("/api/discussions"));
  await page.reload();
  expect((await refreshed).ok()).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "メニューを開く" }).click();
  await expect(dialog).toHaveCSS("animation-name", "none");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});

test("メニューは画面下端まで広がり、Gemini入力欄は画面が縮んでも表示内に収まる", async ({ page }) => {
  await page.getByRole("button", { name: "メニューを開く" }).click();
  const menu = page.getByRole("dialog", { name: "メニュー", exact: true });
  await expect.poll(() => menu.evaluate(element => Math.round(element.getBoundingClientRect().bottom))).toBe(page.viewportSize()!.height);
  await expect(menu.getByText("プレビューユーザー")).toHaveCount(0);
  const selected = menu.getByRole("link", { name: "ホーム", exact: true });
  await expect(selected).toHaveCSS("background-color", "rgb(227, 237, 255)");
  await expect(selected).toHaveCSS("outline-style", "none");
  await expect.poll(() => selected.evaluate(element => Math.round(element.getBoundingClientRect().left))).toBe(0);
  await page.screenshot({ path: ".local-data/sidebar-full-height.png", animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(menu).not.toBeVisible();
  await page.getByRole("button", { name: "Geminiでテーマを考える", exact: true }).click();
  const assistant = page.getByRole("dialog", { name: "Gemini", exact: true });
  await expect(assistant).toBeVisible();
  await expect(assistant).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(assistant.getByRole("heading", { name: /こんにちは/ })).toBeVisible();
  await page.screenshot({ path: ".local-data/gemini-welcome.png", animations: "disabled" });
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 470 }]) {
    await page.setViewportSize(viewport);
    const composer = page.getByRole("textbox", { name: "どんなことを話し合いたい？" });
    await expect.poll(() => composer.evaluate(element => element.getBoundingClientRect().bottom <= window.innerHeight)).toBe(true);
    await expect(assistant.getByRole("button", { name: "テーマを提案してもらう" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: ".local-data/gemini-keyboard-height.png", animations: "disabled" });
  const composer = assistant.getByRole("textbox");
  await composer.focus();
  await composer.evaluate(element => element.blur());
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => assistant.evaluate(element => Math.round(element.getBoundingClientRect().height))).toBe(844);
  await expect.poll(() => composer.evaluate(element => element.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
  await assistant.getByRole("button", { name: "テーマ相談を閉じる" }).click();
  await expect(assistant).not.toBeVisible();
  await page.getByRole("button", { name: "Geminiでテーマを考える", exact: true }).click();
  await expect(assistant).toBeFocused();
  await expect.poll(() => assistant.evaluate(element => Math.round(element.getBoundingClientRect().height))).toBe(844);
  await page.screenshot({ path: ".local-data/gemini-welcome.png", animations: "disabled" });
});

test("項目選択で背景を切り替え、移動先を背面に描画してからメニューを閉じる", async ({ page }) => {
  await page.getByRole("button", { name: "メニューを開く" }).click();
  const menu = page.getByRole("dialog", { name: "メニュー", exact: true });
  await expect(menu.getByRole("button", { name: "メニューを閉じる" })).toHaveCount(0);
  await menu.evaluate(element => {
    const state = window as typeof window & { menuEvents: Array<{ heading: string; selected: string; open: boolean }> };
    state.menuEvents = [];
    const root = element.parentElement!;
    const record = () => state.menuEvents.push({
      heading: root.querySelector("main h1")?.textContent ?? "",
      selected: element.querySelector("[aria-current=page]")?.textContent ?? "",
      open: (element as HTMLDialogElement).open,
    });
    record();
    const observer = new MutationObserver(record);
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["aria-current", "open"] });
    element.addEventListener("close", () => { record(); observer.disconnect(); }, { once: true });
  });
  await menu.getByRole("link", { name: "履歴", exact: true }).click();
  await expect(page).toHaveURL(/\/history$/);
  await expect(menu).not.toBeVisible();
  const events = await page.evaluate(() => (window as typeof window & { menuEvents: Array<{ heading: string; selected: string; open: boolean }> }).menuEvents);
  const selected = events.findIndex(event => event.selected === "履歴" && event.open);
  const destination = events.findIndex(event => event.heading === "履歴" && event.open);
  const closed = events.findIndex(event => !event.open);
  expect(selected).toBeGreaterThanOrEqual(0);
  expect(destination).toBeGreaterThanOrEqual(selected);
  expect(closed).toBeGreaterThan(destination);
});

 test("旧教員ホームとホスト入口は共通ホームに統一される", async ({ page }) => {
  for (const path of ["/teacher", "/host"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole("heading", { name: "ホーム", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "ホストする", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "教員のホーム", exact: true })).toHaveCount(0);
  }
});

test("参加とホスト画面は下から開き、戻るとホームへ閉じる", async ({ page }) => {
  for (const action of ["参加する", "ホストする"] as const) {
    await page.getByRole(action === "参加する" ? "link" : "button", { name: action, exact: true }).click();
    const panel = page.getByRole("region", { name: action, exact: true });
    await expect(panel).toBeVisible();
    const motion = await panel.evaluate(element => {
      const animation = getComputedStyle(element).animationName;
      const frames = (element.getAnimations()[0]?.effect as KeyframeEffect | undefined)?.getKeyframes();
      return { animation, start: frames?.[0]?.transform, end: frames?.at(-1)?.transform };
    });
    expect(motion.animation).toContain("slideUp");
    if (motion.start) {
      expect(motion.start).toBe("translateY(100%)");
      expect(motion.end).toBe("translateY(0px)");
    }
    if (action === "参加する") await expect(panel.getByLabel("参加コード（数字6桁）", { exact: true })).toBeVisible();
    else {
      await panel.getByLabel("テーマ", { exact: true }).fill("新しい議論のテーマ");
      await expect(panel.getByLabel("テーマ", { exact: true })).toHaveValue("新しい議論のテーマ");
    }
    await expect(page.getByRole("button", { name: "Geminiでテーマを考える", exact: true })).toHaveCount(0);
    await panel.getByRole("link", { name: "ホーム", exact: true }).click();
    await expect(panel).not.toBeVisible();
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole("heading", { name: "マイダッシュボード" })).toBeVisible();
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("link", { name: "参加する", exact: true }).click();
  const panel = page.getByRole("region", { name: "参加する", exact: true });
  await expect(panel).toHaveCSS("animation-name", "none");
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/home$/);
});

test("参加・ホスト画面は説明を省き、セッション名とテーマを分けて作成できる", async ({ page }) => {
  await page.getByRole("link", { name: "参加する", exact: true }).click();
  const join = page.getByRole("region", { name: "参加する", exact: true });
  await expect(join.getByRole("heading", { name: "参加する", exact: true })).toBeVisible();
  await expect(join.getByRole("heading", { name: "議論に参加する", exact: true })).toHaveCount(0);
  await expect(join.getByText("参加コード（数字6桁）", { exact: true })).toHaveClass("sr-only");
  await expect(join.getByText("デモデータ", { exact: true })).toHaveCount(0);
  await expect(join.locator(".shell__account")).toHaveCount(0);
  await page.screenshot({ path: ".local-data/join-simple.png", animations: "disabled" });
  await join.getByRole("link", { name: "ホーム", exact: true }).click();
  await expect(join).not.toBeVisible();
  await page.getByRole("button", { name: "ホストする", exact: true }).click();
  const host = page.getByRole("region", { name: "ホストする", exact: true });
  await expect(host.getByLabel("セッション名", { exact: true })).toHaveValue("無題のセッション");
  await expect(host.getByText("デモデータ", { exact: true })).toHaveCount(0);
  await expect(host.locator(".shell__account")).toHaveCount(0);
  await expect(host.getByText("作ったあとの流れ")).toHaveCount(0);
  await expect(host.getByLabel("クラス名（任意）")).toHaveCount(0);
  await host.getByLabel("テーマ", { exact: true }).fill("学校でのAIの使い方");
  await page.screenshot({ path: ".local-data/host-simple.png", animations: "disabled" });
  const created = page.waitForResponse(response => response.url().endsWith("/api/rooms") && response.request().method() === "POST");
  await host.getByRole("button", { name: "作成する", exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON()).toMatchObject({ title: "無題のセッション", theme: "学校でのAIの使い方" });
  const { roomId } = await response.json();
  await expect(page).toHaveURL(new RegExp(`/rooms/${roomId}$`));
});

test("タブレットとPCでも共通ホーム・設定・作成を使える", async ({ page }) => {
  for (const viewport of [{ width: 820, height: 1180 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/home");
    const header = page.locator("header");
    await expect(header).toHaveCSS("position", "relative");
    await expect(page.getByText("デモ", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "ホストする", exact: true })).toBeEnabled();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.local-data/workspace-${viewport.width}.png`, fullPage: true, animations: "disabled" });
    await page.getByRole("button", { name: "Geminiでテーマを考える", exact: true }).click();
    const assistant = page.getByRole("dialog", { name: "Gemini", exact: true });
    await expect(assistant).toBeVisible();
    await expect.poll(() => assistant.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return bounds.left >= 0 && bounds.right <= innerWidth;
    })).toBe(true);
    await assistant.getByRole("button", { name: "テーマ相談を閉じる" }).click();
    await expect(assistant).not.toBeVisible();
    await page.getByRole("button", { name: "ホストする", exact: true }).click();
    const theme = page.getByLabel("テーマ", { exact: true });
    await expect(theme).toBeVisible();
    await expect.poll(() => theme.evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(90);
    await page.goto("/host/profile");
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole("heading", { name: "アカウント・設定", exact: true })).toBeVisible();
  }
});
