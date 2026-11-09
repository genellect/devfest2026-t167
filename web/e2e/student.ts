import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import QRCode from "qrcode";

/** テスト間のログイン回数制限を分離し、同じテストの別端末では同じ本人を使う。 */
export async function loginStudent(page: Page, person = "", { home = true }: { home?: boolean } = {}) {
  const subject = `e2e-student-${createHash("sha256").update(`${test.info().testId}:${test.info().retry}:${test.info().repeatEachIndex}${person ? `:${person}` : ""}`).digest("hex").slice(0, 24)}`;
  await page.route(/identitytoolkit.*accounts:signInWithIdp/, async route => {
    const data = route.request().postDataJSON();
    const body = new URLSearchParams(data.postBody);
    const token = JSON.parse(body.get("id_token") ?? "{}");
    if (token.sub !== "local-student") return route.continue();
    body.set("id_token", JSON.stringify({ ...token, sub: subject, email: `${subject}@example.com` }));
    await route.continue({ postData: JSON.stringify({ ...data, postBody: body.toString() }) });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "テスト用の生徒でログイン（エミュレータ）", includeHidden: true }).evaluate(element => (element as HTMLButtonElement).click());
  // QR・リンク参加以外は、ホストと同じ共通ホームへ進む。
  if (home) {
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole("heading", { name: "ホーム", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "参加する", exact: true }).click();
    await expect(page).toHaveURL(/\/join$/);
  }
  return subject;
}

/** カメラの代わりに、QRコードを映した映像を返す（アプリ内のQR読み取りを確かめるため） */
export async function fakeQrCamera(page: Page, text: string) {
  const dataUrl = await QRCode.toDataURL(text, { margin: 2, width: 360 });
  await page.addInitScript((src) => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (!constraints?.video) return original(constraints);
      const image = new Image(); image.src = src; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = 480; canvas.height = 480;
      const context = canvas.getContext("2d")!;
      const draw = () => { context.fillStyle = "#fff"; context.fillRect(0, 0, 480, 480); context.drawImage(image, 60, 60, 360, 360); requestAnimationFrame(draw); };
      draw();
      return canvas.captureStream(10);
    };
  }, dataUrl);
}
