import { expect, type Page } from "@playwright/test";
export function registrationWave() {
  const samples = 9 * 16000, b = Buffer.alloc(44 + samples * 2);
  b.write("RIFF"); b.writeUInt32LE(36 + samples * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) b.writeInt16LE(Math.round(4000 * Math.sin(i * Math.PI * 2 * 220 / 16000)), 44 + i * 2);
  return b;
}
export async function enrollCurrentVoice(page: Page) {
  await page.getByLabel(/の登録用音声ファイル$/).setInputFiles({ name: "synthetic-registration.wav", mimeType: "audio/wav", buffer: registrationWave() });
  await expect(page.getByRole("heading", { name: "声の登録", exact: true })).toHaveCount(0);
}
export async function enterCurrentSession(page: Page) {
  await page.getByLabel("参加者1の表示名", { exact: true }).fill("テスト参加者");
  await page.getByRole("button", { name: "表示名を保存して進む", exact: true }).click();
  await enrollCurrentVoice(page);
}
