import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import QRCode from "qrcode";
import { loginGoogle } from "./google";

/** テスト間のログイン回数制限を分離し、同じテストの別端末では同じ本人を使う。 */
export async function loginStudent(page: Page, person = "", { home = true }: { home?: boolean } = {}) {
  const subject = `e2e-student-${createHash("sha256").update(`${test.info().testId}:${test.info().retry}${person ? `:${person}` : ""}`).digest("hex").slice(0, 24)}`;
  await page.goto("/");
  await loginGoogle(page, "student", subject);
  // 学生はログインのあと参加コードの入力へ進む。QRやリンクから来た人は、そのまま参加する
  if (home) {
    await expect(page).toHaveURL(/\/join$/);
    await expect(page.getByRole("heading", { name: "議論に参加する" })).toBeVisible();
    await page.goto("/home");
    await expect(page.getByRole("heading", { name: "あなたのホーム" })).toBeVisible();
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
