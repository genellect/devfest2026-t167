import { expect, test } from "@playwright/test";
import { loginGoogle } from "./google";

// AuthエミュレータのHTMLはアカウント一覧の後にクリック処理を登録する。
// 一覧が見えていても末尾のスクリプトを待っている状態を再現する。
test("模擬Googleのアカウント選択処理が読み込まれるまで待ってログインする", async ({ page }) => {
  await page.context().route("**/emulator/auth/handler?*", async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      "<script>\nfunction assert",
      '<script src="/emulator/test-selection-ready.js"></script><script>\nfunction assert',
    );
    expect(body).toContain("test-selection-ready.js");
    await route.fulfill({ response, body });
  });
  await page.context().route("**/emulator/test-selection-ready.js", async route => {
    // 制御したネットワーク遅延。実際のクリック処理はエミュレータのものを使う。
    await new Promise(resolve => setTimeout(resolve, 800));
    await route.fulfill({ contentType: "application/javascript", body: "/* selection readiness gate */" });
  });
  await page.goto("/");
  await loginGoogle(page, "student", `ready-${Date.now()}`);
  await expect(page).toHaveURL(/\/home$/);
  const cookie = (await page.context().cookies()).find(c => c.name === "discuss_session_dev");
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Strict" });
});
