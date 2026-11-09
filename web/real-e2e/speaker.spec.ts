import { expect, test } from '@playwright/test';
import { loginStudent } from '../e2e/student';
import { resolve } from 'node:path';

test('公開人声を画面で登録し、別録音をマイク入力として実モデルへ送りHostとGuestへ表示する', async ({ page, browser }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'テスト用の先生でログイン（エミュレータ）', exact: true }).click();
  await page.waitForURL(/\/(?:teacher|home)$/);
  await page.goto('/host/new');
  await page.getByLabel('テーマ', { exact: true }).fill('公開人声・実モデル接続確認');
  await page.getByRole('button', { name: '作成する', exact: true }).click();
  await expect(page).toHaveURL(/\/rooms\//);
  const code = (await page.getByTestId('join-code').textContent())!.replace(/\s/g, '');
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const guest = await context.newPage();
    guest.on('pageerror', e => errors.push(e.message));
    await loginStudent(guest);
    await guest.goto(`/join?code=${code}`);
    await guest.getByRole('button', { name: '1台を複数人で使う', exact: true }).click();
    await guest.getByLabel('参加者1の表示名').fill('公開サンプルA');
    await guest.getByRole('button', { name: '参加者を追加', exact: true }).click();
    await guest.getByLabel('参加者2の表示名').fill('公開サンプルB');
    await guest.getByRole('button', { name: '表示名を保存して進む', exact: true }).click();
    const folder = process.env.SPEAKER_PUBLIC_SAMPLE_DIR ?? resolve('../.local-data/public-voices');
    for (const [i, label] of ['公開サンプルA', '公開サンプルB'].entries()) {
      const input = guest.getByLabel(`${label}の登録用音声ファイル`);
      await input.locator('..').getByText('録音済みの音声から登録する', { exact: true }).click();
      await input.setInputFiles(resolve(folder, `speaker-${i + 1}-enroll.wav`));
      if (!i) await expect(guest.getByRole('button', { name: `${label} 登録済み`, exact: true })).toBeVisible();
    }
    await guest.getByLabel('あなたの意見（本人だけが見られます）').fill('公開サンプルによる接続確認の意見です。');
    await guest.getByRole('button', { name: '提出する', exact: true }).click();
    await expect(guest.getByRole('heading', { name: '開始を待っています', exact: true })).toBeVisible();
    for (const label of ['公開サンプルA', '公開サンプルB']) await expect(page.getByRole('region', { name: 'グループの状況' })).toContainText(label);
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await page.getByLabel('参加者に所属グループの発言時間の推定を表示').check();
    await page.getByLabel('終了時に所属グループの結果を自動公開する').check();
    await page.getByRole('button', { name: '閉じる', exact: true }).click();
    await page.getByRole('button', { name: '議論を開始', exact: true }).click();
    await guest.getByRole('button', { name: '設定', exact: true }).click();
    await guest.getByRole('button', { name: '録音を始める', exact: true }).click();
    await page.getByRole('button', { name: 'グループ1の詳細', exact: true }).click();
    const rates = page.getByRole('region', { name: 'グループ1の発言時間', exact: true });
    await expect(rates.getByText('実音声モデルで照合しています。')).toBeVisible({ timeout: 15_000 });
    for (const label of ['公開サンプルA', '公開サンプルB']) {
      await expect.poll(async () => Number(await rates.getByRole('progressbar', { name: `${label}の発言率` }).getAttribute('value')), { timeout: 30_000 }).toBeGreaterThan(0);
    }
    await expect(guest.getByRole('region', { name: 'グループ1の発言時間', exact: true }).getByText('実音声モデルで照合しています。')).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: '../docs/screenshots/public-speaker-host-desktop.png', fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '../docs/screenshots/public-speaker-host-mobile.png', fullPage: false });
    await guest.setViewportSize({ width: 390, height: 844 });
    await guest.screenshot({ path: '../docs/screenshots/public-speaker-guest-mobile.png', fullPage: false });
    expect(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await guest.getByRole('button', { name: '録音を停止して端末に保管', exact: true }).click();
    await expect(guest.getByRole('button', { name: '録音は停止済みです', exact: true })).toBeVisible();
    await page.getByRole('dialog', { name: 'グループ1', exact: true }).getByRole('button', { name: '閉じる', exact: true }).click();
    await page.getByRole('button', { name: '議論を終える', exact: true }).click();
    await page.getByRole('button', { name: '終了する', exact: true }).click();
    await expect(guest.getByRole('heading', { name: '結論を自分の言葉で書く', exact: true })).toBeVisible();
    await guest.getByLabel('グループの結論を、あなたはどう理解した？').fill('公開サンプルで登録と発言時間の表示を確認できました。');
    await guest.getByRole('button', { name: '4 おおむね納得', exact: true }).click();
    await guest.getByRole('button', { name: '提出する', exact: true }).click();
    await expect(guest.getByRole('heading', { name: '議論の前と後を比べる', exact: true })).toBeVisible();
    await expect(guest.getByText('録音の送信・分析が完了しました。', { exact: true })).toBeVisible({ timeout: process.env.T167_REAL_GEMINI === '1' ? 210_000 : 20_000 });
    await expect(page.getByText('分析済み 1/1グループ', { exact: true })).toBeVisible();
    await expect(guest.getByRole('region', { name: 'あなたの発言時間', exact: true })).toBeVisible();
    if (process.env.T167_REAL_GEMINI === '1') {
      await expect(guest.getByText('デモデータ', { exact: true })).toHaveCount(0);
      await guest.screenshot({ path: '../docs/screenshots/real-gemini-result-mobile.png', fullPage: true });
      await page.screenshot({ path: '../docs/screenshots/real-gemini-host-result.png', fullPage: true });
    }
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
