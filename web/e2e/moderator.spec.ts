import { expect, test } from "@playwright/test";

test("教員のホームから作成し、開始・強制終了・結果・教員のホームへ進む", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "テスト用の先生でログイン（エミュレータ）" }).click();
  await expect(page).toHaveURL(/\/teacher$/);
  await page.getByRole("link", { name: "議論を作る", exact: true }).click();
  await page.getByLabel("テーマ", { exact: true }).fill("チームで何を作るか");
  await page.getByRole("button", { name: "作成する", exact: true }).click();
  await expect(page).toHaveURL(/\/rooms\//);
  await page.getByRole("button", { name: "議論を開始", exact: true }).click();
  // 時間は設定しない。教員が終えるまで議論が続く
  await expect(page.getByRole("button", { name: "議論を終える", exact: true })).toBeVisible();
  // 教員には経過時間だけを出す（残り時間のカウントダウンは出さない）
  await expect(page.getByRole("timer", { name: "経過時間" })).toBeVisible();
  await expect(page.getByRole("timer", { name: "残り時間" })).toHaveCount(0);
  await page.getByRole("button", { name: "議論を終える", exact: true }).click();
  await page.getByRole("button", { name: "終えて結果を見る", exact: true }).click();
  await expect(page.getByRole("heading", { name: "録音の振り返り", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "ホームに戻る", exact: true }).click();
  await expect(page).toHaveURL(/\/teacher$/);
  await expect(page.getByRole("region", { name: "作った議論" }).getByRole("link", { name: /チームで何を作るか/ }).first()).toContainText("終了");
});

test("作成画面で Gemini のテーマ案を出し、選んだ案がテーマの欄に入る", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "テスト用の先生でログイン（エミュレータ）" }).click();
  await page.getByRole("link", { name: "議論を作る", exact: true }).click();
  await page.getByLabel("授業の内容や、話し合ってほしいこと").fill("高校2年の情報。SNSの情報の見分け方");
  await page.getByRole("button", { name: "案を出す", exact: true }).click();
  const ideas = page.getByRole("group", { name: "テーマ案" }).getByRole("button");
  await expect(ideas).toHaveCount(3);
  const first = (await ideas.first().innerText()).trim();
  await ideas.first().click();
  await expect(page.getByLabel("テーマ", { exact: true })).toHaveValue(first);
  await expect(ideas.first()).toHaveAttribute("aria-pressed", "true");
  // 別の案は、前の3つと重ならない
  await page.getByRole("button", { name: "別の案を出す", exact: true }).click();
  await expect(page.getByRole("group", { name: "テーマ案" }).getByRole("button", { name: first, exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "作成する", exact: true }).click();
  await expect(page).toHaveURL(/\/rooms\//);
  await expect(page.getByRole("heading", { name: first })).toBeVisible();
});
