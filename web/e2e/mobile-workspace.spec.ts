import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { emulatorGoogleUser } from "../../firebase/emulator-auth.mjs";

// 共通の画面（Figma「最新」02-T・06・M-02・メニュー）：上の帯・左のメニュー（ホーム・設定）・灰色のパネル。
// スマホでは左のメニューを「≡」で開く。#80 の機能（Gemini のテーマ案・履歴の検索・プロフィール）はこの骨組みの中に置く。
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
  await expect(page.getByRole("heading", { name: "あなたのホーム", exact: true })).toBeVisible();
});

test("教員のホームは作成から始まり、議論がなければ空の案内を出す", async ({ page }) => {
  await expect(page.getByRole("link", { name: "議論を作る", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Geminiでテーマを考える" })).toBeVisible();
  // 教員のホームに参加の入力は置かない（Figma 02-T）。参加は /join から
  await expect(page.getByLabel("参加コード")).toHaveCount(0);
  const mine = page.getByRole("region", { name: "あなたのセッション" });
  await expect(mine.getByText("参加した議論が、ここに並びます。")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("スマホは「≡」でメニューを開き、設定へ進むと閉じる。Escape と背景でも閉じる", async ({ page }) => {
  const open = page.getByRole("button", { name: "メニュー", exact: true });
  const nav = page.getByRole("navigation", { name: "メニュー", exact: true });
  await expect(nav).not.toBeVisible();
  await open.click();
  await expect(open).toHaveAttribute("aria-expanded", "true");
  await expect(nav.getByRole("link", { name: "ホーム", exact: true })).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Escape");
  await expect(nav).not.toBeVisible();
  await open.click();
  await page.getByRole("button", { name: "メニューを閉じる" }).click({ position: { x: 360, y: 400 } });
  await expect(nav).not.toBeVisible();
  await open.click();
  await nav.getByRole("link", { name: "設定", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "設定", exact: true })).toBeVisible();
  await expect(nav).not.toBeVisible();
  await expect(page.getByRole("link", { name: "端末とセッション" })).toBeVisible();
  await expect(page.getByRole("link", { name: "使い方とプライバシー" })).toBeVisible();
  await page.screenshot({ path: ".local-data/settings-phone.png", animations: "disabled" });
});

test("Geminiのテーマ案を作成画面で選び、セッション名とテーマを分けて作成できる", async ({ page }) => {
  await page.getByRole("link", { name: "Geminiでテーマを考える" }).click();
  await expect(page).toHaveURL(/\/host\/new#ideas$/);
  await expect(page.getByLabel("セッション名", { exact: true })).toHaveValue("無題のセッション");
  await page.getByLabel("授業の内容や、話し合ってほしいこと").fill("学校でのAIの使い方");
  const suggested = page.waitForResponse(reply => reply.url().includes("/api/themes/suggest") && reply.request().method() === "POST");
  await page.getByRole("button", { name: "案を出す", exact: true }).click();
  const { themes } = await (await suggested).json() as { themes: string[] };
  await page.getByRole("group", { name: "テーマ案" }).getByRole("button", { name: themes[0], exact: true }).click();
  await expect(page.getByLabel("テーマ", { exact: true })).toHaveValue(themes[0]);
  const created = page.waitForResponse(response => response.url().endsWith("/api/rooms") && response.request().method() === "POST");
  await page.getByRole("button", { name: "作成する", exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON()).toMatchObject({ title: "無題のセッション", theme: themes[0] });
  const { roomId } = await response.json();
  await expect(page).toHaveURL(new RegExp(`/rooms/${roomId}$`));
  // 作った議論はホームの一覧に出る。状態だけを添える（Figma 02-T）
  await page.goto("/home");
  await expect(page.getByRole("region", { name: "あなたのセッション" }).getByRole("link", { name: new RegExp(themes[0].slice(0, 8).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })).toContainText("準備中");
});

test("これまでの議論を検索でき、ログアウトするとログイン画面に戻る", async ({ page }) => {
  await page.goto("/history");
  await expect(page.getByRole("heading", { name: "これまでの議論", exact: true })).toBeVisible();
  const search = page.getByRole("searchbox", { name: "履歴を検索" });
  await search.fill("一致しない検索");
  await expect(page.getByText("一致する議論はありません。別の言葉で探してください。")).toBeVisible();
  await page.goto("/settings");
  await page.getByRole("button", { name: "ログアウト", exact: true }).click();
  await expect(page.getByRole("button", { name: "Googleでログイン", exact: true })).toBeVisible();
  await expect(page.getByText(/ログインし直してください/)).toHaveCount(0);
});

test("旧教員ホームとホスト入口は共通ホームに統一される", async ({ page }) => {
  for (const path of ["/teacher", "/host"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole("heading", { name: "あなたのホーム", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "教員のホーム", exact: true })).toHaveCount(0);
  }
});

test("タブレットとPCでは左のメニューをいつも出し、横にはみ出さない", async ({ page }) => {
  for (const viewport of [{ width: 820, height: 1180 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/home");
    const nav = page.getByRole("navigation", { name: "メニュー", exact: true });
    await expect(nav).toBeVisible();
    await expect(page.getByRole("button", { name: "メニュー", exact: true })).not.toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.local-data/workspace-${viewport.width}.png`, fullPage: true, animations: "disabled" });
    await nav.getByRole("link", { name: "設定", exact: true }).click();
    await expect(page.getByRole("heading", { name: "設定", exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "設定", exact: true })).toHaveAttribute("aria-current", "page");
    await page.goto("/host/profile");
    await expect(page).toHaveURL(/\/settings$/);
    await page.goto("/host/new");
    const theme = page.getByLabel("テーマ", { exact: true });
    await expect(theme).toBeVisible();
    await expect.poll(() => theme.evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(90);
  }
});
