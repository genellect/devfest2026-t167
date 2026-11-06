import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

/** テスト間のログイン回数制限を分離し、同じテストの別端末では同じ本人を使う。 */
export async function loginStudent(page: Page) {
  const subject = `e2e-student-${createHash("sha256").update(`${test.info().testId}:${test.info().retry}`).digest("hex").slice(0, 24)}`;
  await page.route(/identitytoolkit.*accounts:signInWithIdp/, async route => {
    const data = route.request().postDataJSON();
    const body = new URLSearchParams(data.postBody);
    const token = JSON.parse(body.get("id_token") ?? "{}");
    if (token.sub !== "local-student") return route.continue();
    body.set("id_token", JSON.stringify({ ...token, sub: subject, email: `${subject}@example.com` }));
    await route.continue({ postData: JSON.stringify({ ...data, postBody: body.toString() }) });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "テスト用の生徒でログイン（エミュレータ）" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("heading", { name: "あなたのホーム" })).toBeVisible();
  return subject;
}
