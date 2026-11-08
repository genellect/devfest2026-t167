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
  // 参加者がいない議論は、結果がないことだけを出す（空の指標や録音の欄は出さない）
  await expect(page.getByRole("heading", { name: "この議論には参加者がいませんでした", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "録音の振り返り", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "教員のホームに戻る", exact: true }).click();
  await expect(page).toHaveURL(/\/teacher$/);
  await expect(page.getByRole("region", { name: "作った議論" }).getByRole("link", { name: /チームで何を作るか/ }).first()).toContainText("終了");
});
