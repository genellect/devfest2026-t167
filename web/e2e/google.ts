import { type Page } from "@playwright/test";
import { emulatorGoogleUser } from "../../firebase/emulator-auth.mjs";

/** 本番と同じ唯一のボタンを使い、本人確認だけローカルのGoogle認証エミュレータで行う。 */
export async function loginGoogle(page: Page, kind: "teacher" | "student", subject = `local-${kind}`) {
  await emulatorGoogleUser(kind, subject);
  const popupReady = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Googleでログイン", exact: true }).click();
  const popup = await popupReady;
  // ローカル試験で外部のフォント・CSSを取得しない。
  await popup.route(/https:\/\/(fonts\.|unpkg\.)/, route => route.abort());
  await popup.locator(".js-reuse-account").filter({ hasText: `${subject}@example.com` }).click();
}
