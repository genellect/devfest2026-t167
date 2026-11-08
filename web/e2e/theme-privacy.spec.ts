import { expect, test } from "@playwright/test";
import { loginGoogle } from "./google";
import { loginStudent } from "./student";

// R1：テーマを非公開にしてからテーマを保存しても、セッション名は壊れず、参加者の画面・再読み込み・履歴にテーマ本文が出ない。
// 画面・認証（エミュレータ）・API・SSE を通す。Host には引き続きテーマが見える。
const SECRET = "架空の非公開テーマ：端末を持たない人の参加をどう保障するか";
const NAME = "架空の授業 第2回";

test("テーマ非公開のあとにテーマを保存しても、参加者にはセッション名だけが出る", async ({ page, browser }) => {
  await page.goto("/");
  await loginGoogle(page, "teacher");
  await page.waitForURL(/\/home$/); await page.goto("/host/new");
  await page.getByLabel("テーマ", { exact: true }).fill("公開している仮のテーマ");
  await page.getByLabel("セッション名", { exact: true }).fill(NAME);
  await page.getByRole("button", { name: "セッションを作成", exact: true }).click();
  await expect(page).toHaveURL(/\/rooms\//);
  const code = (await page.getByTestId("join-code").textContent())!.replace(/\s/g, "");

  // Host：参加者へのテーマ表示を切ってから、テーマを書き換えて保存する
  await page.getByRole("button", { name: "設定", exact: true }).click();
  const show = page.getByRole("checkbox", { name: "参加者にテーマを表示", exact: true });
  await show.uncheck(); await expect(show).not.toBeChecked();
  await page.locator("#set-theme-input").fill(SECRET);
  await page.getByRole("button", { name: "テーマを保存", exact: true }).click();
  await expect(page.locator("#set-theme-input")).toHaveValue(SECRET);

  const context = await browser.newContext({ baseURL: new URL(page.url()).origin, viewport: { width: 390, height: 844 } });
  try {
    const guest = await context.newPage();
    await loginStudent(guest, "guest");
    await guest.goto(`/join?code=${code}`);
    await expect(guest).toHaveURL(/\/rooms\//);
    await guest.getByRole("button", { name: "1台を複数人で使う", exact: true }).click();
    await guest.getByLabel("参加者1の表示名").fill("共有端末");
    await guest.getByRole("button", { name: "表示名を保存して進む" }).click();
    await expect(guest.getByRole("heading", { name: "参加できました", exact: true })).toBeVisible();
    await expect(guest.locator("body")).not.toContainText(SECRET);
    await guest.reload();
    await expect(guest.getByRole("heading", { name: "参加できました", exact: true })).toBeVisible();
    await expect(guest.locator("body")).not.toContainText(SECRET);

    // 議論中もセッション名だけを出す
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "議論を開始", exact: true }).click();
    const live = guest.getByRole("main", { name: "話し合い中", exact: true });
    await expect(live).toBeVisible();
    await expect(live.getByRole("heading", { name: NAME, exact: true })).toBeVisible();
    await expect(guest.locator("body")).not.toContainText(SECRET);

    // 参加者の履歴の一覧にも出さない
    await guest.goto("/history");
    await expect(guest.getByRole("heading", { name: "テーマ非公開", exact: true })).toBeVisible();
    await expect(guest.locator("body")).not.toContainText(SECRET);

    // Host にはテーマが見えたまま
    await expect(page.locator("body")).toContainText(SECRET);
  } finally { await context.close(); }
});
