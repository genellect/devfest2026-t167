import { expect, test, type Page } from "@playwright/test";
import { loginStudent } from "./student";

async function capture(page: Page, name: string) {
  if (!name.startsWith("shared-")) {
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expect(page.getByRole("banner")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "ホーム", exact: true })).toBeVisible();
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `../docs/screenshots/session-${name}-mobile.png`, fullPage: true, scale: "css" });
  const previous = page.viewportSize();
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `../docs/screenshots/session-${name}-tablet.png`, fullPage: true, scale: "css" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `../docs/screenshots/session-${name}-desktop.png`, fullPage: true, scale: "css" });
  if (previous) await page.setViewportSize(previous);
}

test("7画面を通り、待機中の編集とホストの結果公開・公開停止が反映される", async ({ page: host, browser }) => {
  await host.goto("/");
  await host.getByRole("button", { name: "テスト用の先生でログイン（エミュレータ）", includeHidden: true }).evaluate(element => (element as HTMLButtonElement).click());
  await host.waitForURL(/\/(?:teacher|home)$/);
  if (new URL(host.url()).pathname === "/home") await capture(host, "shared-home");
  await host.goto("/host/new");
  await host.getByLabel("テーマ", { exact: true }).fill("学校でのAIの使い方を考える");
  await host.getByRole("button", { name: "作成する", exact: true }).click();
  await expect(host).toHaveURL(/\/rooms\//);
  const code = (await host.getByTestId("join-code").textContent())!.replace(/\s/g, "");
  const context = await browser.newContext({ baseURL: new URL(host.url()).origin, viewport: { width: 390, height: 844 } });
  const guest = await context.newPage();
  const errors: string[] = [];
  for (const page of [host, guest]) page.on("pageerror", (e) => errors.push(e.message));
  try {
    await loginStudent(guest);
    await guest.goto(`/join?code=${code}`);
    await guest.getByLabel("参加者1の表示名").fill("テスト参加者");
    await guest.getByRole("button", { name: "表示名を保存して進む" }).click();
    await expect(guest.getByRole("heading", { name: "声の登録", exact: true })).toBeVisible();
    await capture(guest, "guest-voice");
    await guest.getByLabel("声の特徴の登録と、上記の利用方法に同意します").check();
    await guest.getByRole("button", { name: "声を登録する", exact: true }).click();
    await expect(guest.getByText(/あと\d秒、そのまま読み上げてください/)).toBeVisible();
    await guest.getByLabel("あなたの意見（本人だけが見られます）").fill("本人だけの事前意見：使った箇所を申告するべきだ");
    await guest.getByRole("button", { name: "提出する", exact: true }).click();
    await expect(guest.getByRole("heading", { name: "開始を待っています", exact: true })).toBeVisible();
    await capture(guest, "guest-waiting");
    await guest.getByText("提出した意見を確認・編集", { exact: true }).click();
    await guest.getByLabel("あなたの意見（本人だけが見られます）").fill("本人だけの事前意見：利用箇所と理由を申告するべきだ");
    await guest.getByRole("button", { name: "書き直して提出する", exact: true }).click();
    await expect(guest.getByRole("button", { name: "書き直して提出する", exact: true })).toBeEnabled();
    await expect(host.getByRole("region", { name: "グループの状況" })).toContainText("テスト参加者");
    await expect(host.locator("main")).not.toContainText("本人だけの事前意見");
    await capture(host, "host-waiting");
    await host.getByRole("button", { name: "設定", exact: true }).click();
    await host.getByLabel("終了時に所属グループの結果を自動公開する").uncheck();
    await expect(host.getByRole("status").filter({ hasText: "保存しました。" })).toBeVisible();
    await capture(host, "host-settings");
    await host.getByRole("button", { name: "閉じる", exact: true }).click();
    await host.getByRole("button", { name: "議論を開始", exact: true }).click();
    await expect(guest.getByRole("heading", { name: "グループで話し合いましょう" })).toBeVisible();
    await expect(guest.getByRole("timer")).toHaveCount(0);
    await capture(guest, "guest-live");
    await capture(host, "host-live");
    await host.getByRole("button", { name: "議論を終える", exact: true }).click();
    await host.getByRole("button", { name: "終えて結果を見る", exact: true }).click();
    await guest.getByLabel("グループの結論を、あなたはどう理解した？").fill("本人だけの結論：利用箇所を申告して使う");
    await guest.getByRole("button", { name: "4 おおむね納得", exact: true }).click();
    await guest.getByRole("button", { name: "提出する", exact: true }).click();
    await expect(guest.getByText("結果は教員が公開すると表示されます。", { exact: true })).toBeVisible();
    await expect(guest.getByRole("heading", { name: "議論の前と後を比べる" })).toHaveCount(0);
    await expect(host.getByRole("region", { name: "結果の公開状態" })).toContainText("結果は非公開です");
    await host.getByRole("button", { name: "結果を参加者に公開する", exact: true }).click();
    await expect(guest.getByRole("heading", { name: "議論の前と後を比べる" })).toBeVisible();
    await expect(guest.getByRole("region", { name: "議論の前と後を比べる" })).toContainText("本人だけの事前意見：利用箇所と理由を申告するべきだ");
    await expect(guest.getByRole("region", { name: "議論の前と後を比べる" })).toContainText("本人だけの結論：利用箇所を申告して使う");
    await expect(host.locator("main")).not.toContainText("本人だけの結論");
    await capture(guest, "guest-result");
    await capture(host, "host-result");
    await host.getByRole("button", { name: "結果を非公開にする", exact: true }).click();
    await expect(guest.getByRole("heading", { name: "議論の前と後を比べる" })).toHaveCount(0);
    await expect(guest.getByText("結果は教員が公開すると表示されます。", { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
