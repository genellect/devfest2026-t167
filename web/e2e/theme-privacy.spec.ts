import { expect, test } from "@playwright/test";
import { loginStudent } from "./student";

// テーマを非公開にした議論で、テーマ本文が議論の名前（作成画面ではテーマと同じ値）を通って参加者の画面に出ないこと。
// 画面・認証（エミュレータ）・API・SSE を通す。教員にはテーマが見えたまま。
const SECRET = "架空の非公開テーマ：端末を持たない人の参加をどう保障するか";  // submit-allow: テスト用のダミー

test("テーマを非公開にすると、参加者の画面・再読み込み・議論中にテーマ本文が出ない", async ({ page, browser }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "テスト用の先生でログイン（エミュレータ）" }).click();
  await page.getByRole("link", { name: "議論を作る", exact: true }).click();
  await page.getByLabel("テーマ", { exact: true }).fill(SECRET);
  await page.getByRole("button", { name: "作成する", exact: true }).click();
  await expect(page).toHaveURL(/\/rooms\//);
  const code = (await page.getByTestId("join-code").innerText()).replace(/\D/g, "");

  await page.getByRole("button", { name: "設定", exact: true }).click();
  const show = page.getByRole("checkbox", { name: "参加者にテーマを表示", exact: true });
  await show.uncheck(); await expect(show).not.toBeChecked();
  await page.getByRole("button", { name: "閉じる", exact: true }).click();

  const context = await browser.newContext({ baseURL: new URL(page.url()).origin, viewport: { width: 390, height: 844 } });
  try {
    const guest = await context.newPage();
    await loginStudent(guest, "guest");
    await guest.goto(`/join?code=${code}`);
    await expect(guest).toHaveURL(/\/rooms\//);
    await guest.getByLabel("参加者1の表示名", { exact: true }).fill("参加者");
    await guest.getByRole("button", { name: "表示名を保存して進む", exact: true }).click();
    await guest.getByRole("button", { name: "あとで登録する", exact: true }).click();
    await expect(guest.getByRole("heading", { name: "話し合い", exact: true })).toBeVisible();
    await expect(guest.locator("body")).not.toContainText(SECRET.slice(0, 12));
    await guest.reload();
    await expect(guest.getByRole("heading", { name: "話し合い", exact: true })).toBeVisible();
    await expect(guest.locator("body")).not.toContainText(SECRET.slice(0, 12));

    // 議論中も出さない
    await page.getByRole("button", { name: "議論を開始", exact: true }).click();
    await expect(guest.getByRole("heading", { name: "グループで話し合いましょう" })).toBeVisible();
    await expect(guest.locator("body")).not.toContainText(SECRET.slice(0, 12));

    // 参加者のホームの一覧にも出さない
    await guest.goto("/home");
    await expect(guest.getByRole("heading", { name: "あなたのホーム" })).toBeVisible();
    await expect(guest.locator("body")).not.toContainText(SECRET.slice(0, 12));

    // 教員にはテーマが見えたまま
    await expect(page.locator("body")).toContainText(SECRET);
  } finally { await context.close(); }
});
