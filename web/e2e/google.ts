import { type Page, type Route } from "@playwright/test";
import { emulatorGoogleUser } from "../../firebase/emulator-auth.mjs";

const emulatorAssets = /^https:\/\/(?:fonts\.(?:googleapis|gstatic)\.com|unpkg\.com)\//;

/** 本番と同じ唯一のボタンを使い、本人確認だけローカルのGoogle認証エミュレータで行う。 */
export async function loginGoogle(page: Page, kind: "teacher" | "student", subject = `local-${kind}`) {
  await emulatorGoogleUser(kind, subject);
  // popupが開いてからでは、外部アセットのリクエストが先に始まる場合がある。
  const blockAssets = (route: Route) => route.abort();
  await page.context().route(emulatorAssets, blockAssets);
  try {
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      page.getByRole("button", { name: "Googleで続行", exact: true }).click(),
    ]);
    // 一覧DOMの後にあるスクリプトがクリック処理を登録するまで押さない。
    await popup.waitForURL(/\/emulator\/auth\/handler(?:\?|$)/, { waitUntil: "domcontentloaded" });
    // Cookie拒否もここでは応答まで待ち、成否は各テストで画面と共に検証する。
    await Promise.all([
      page.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname === "/api/sessions/current", { timeout: 20_000 }),
      popup.locator(".js-reuse-account").filter({ hasText: `${subject}@example.com` }).click(),
    ]);
  } finally {
    await page.context().unroute(emulatorAssets, blockAssets);
  }
}
