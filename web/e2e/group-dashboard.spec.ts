import { expect, test } from "@playwright/test";
import { loginGoogle } from "./google";

test("実セッションのグループ詳細は未取得を明示し、閉じると同じ一覧へ戻る", async ({ page }) => {
  await page.goto("/"); await loginGoogle(page, "teacher", "group-detail-host");
  await page.goto("/host/new"); await page.getByLabel("テーマ", { exact: true }).fill("グループ詳細の確認");
  await page.getByRole("button", { name: "セッションを作成", exact: true }).click();
  await expect(page.getByTestId("join-code")).toBeVisible();
  await page.getByRole("button", { name: "議論を開始", exact: true }).click();
  await expect(page.getByRole("heading", { name: "グループの状況", exact: true })).toBeVisible();
  const open = page.getByRole("button", { name: "グループ1の詳細を開く", exact: true });
  await open.click(); const detail = page.getByRole("dialog", { name: "グループ1", exact: true });
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("録音担当端末から発言データが届くと表示します。");
  await expect(detail).toContainText("区間ごとの発言履歴はまだ取得していません。");
  await expect(detail).toContainText("セッション全体の分析");
  await expect(detail.getByText("実音声モデルによる推定", { exact: true })).toHaveCount(0);
  await expect(detail.getByRole("heading", { name: /^今の論点/ })).not.toContainText("AI推定");
  await expect.poll(async () => (await detail.boundingBox())?.y).toBe(0);
  expect((await detail.boundingBox())?.x).toBe(0);
  await page.keyboard.press("Escape"); await expect(detail).not.toBeVisible(); await expect(open).toBeFocused();
  await page.emulateMedia({ reducedMotion: "reduce" }); await open.click();
  await detail.getByRole("button", { name: "グループ一覧へ戻る", exact: true }).click();
  await expect(detail).not.toBeVisible(); await expect(open).toBeFocused();
});
