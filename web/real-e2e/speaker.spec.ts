import { expect, test } from '@playwright/test';
import { loginStudent } from '../e2e/student';
import { resolve } from 'node:path';

test('公開人声を画面で登録し、別録音をマイク入力として実モデルへ送りHostとGuestへ表示する', async ({ page, browser }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'テスト用の先生でログイン（エミュレータ）' }).click();
  await page.waitForURL(/\/home$/); await page.goto('/host/new');
  await page.getByLabel('セッション名', { exact: true }).fill('公開人声・実モデル接続確認');
  await page.getByLabel('テーマ', { exact: true }).fill('公開サンプルによる接続確認');
  await page.getByRole('button', { name: '1', exact: true }).click();
  await page.getByRole('button', { name: '部屋を作る', exact: true }).click();
  await expect(page).toHaveURL(/\/rooms\//);
  await page.getByRole('button', { name: '参加コードを表示', exact: true }).click();
  const code = (await page.getByTestId('join-code').textContent())!.trim();
  await page.getByRole('button', { name: 'ダッシュボードを見る' }).click();
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const guest = await context.newPage(); await loginStudent(guest);
    await guest.goto(`/join?code=${code}`); await guest.getByRole('button', { name: '参加する', exact: true }).click();
    await guest.getByLabel('参加する端末').selectOption('shared');
    await guest.getByLabel('参加者1の表示名').fill('公開サンプルA');
    await guest.getByRole('button', { name: 'この端末の参加者を追加' }).click();
    await guest.getByLabel('参加者2の表示名').fill('公開サンプルB');
    await guest.getByRole('button', { name: '表示名を保存して進む' }).click();
    await guest.getByLabel('声の特徴の登録と、上記の利用方法に同意します').check();
    const folder = process.env.SPEAKER_PUBLIC_SAMPLE_DIR ?? resolve('../.local-data/public-voices');
    for (const [i, label] of ['公開サンプルA', '公開サンプルB'].entries()) {
      const input = guest.getByLabel(`${label}の登録用音声ファイル`);
      await input.locator('..').getByText('録音済みの音声から登録', { exact: true }).click();
      await input.setInputFiles(resolve(folder, `speaker-${i + 1}-enroll.wav`));
      if (!i) await expect(guest.getByRole('button', { name: '登録済み', exact: true })).toHaveCount(1);
    }
    await expect(guest.getByRole('heading', { name: '待機画面' })).toBeVisible();
    await page.getByText('セッション設定・グループ管理', { exact: true }).click();
    await page.getByLabel('Guestに所属グループの発言時間の推定を表示').check();
    await page.getByRole('button', { name: 'セッションを開始', exact: true }).click();
    await guest.getByLabel('グループ全員が録音・声の照合・発言時間の集計に同意しました').check();
    await guest.getByRole('button', { name: '録音を始める', exact: true }).click();
    const rates = page.getByRole('region', { name: 'グループ1の発言時間', exact: true });
    await expect(rates.getByText('実音声モデルで照合しています。')).toBeVisible({ timeout: 15_000 });
    for (const label of ['公開サンプルA', '公開サンプルB']) {
      await expect.poll(async () => Number(await rates.getByRole('progressbar', { name: `${label}の発言率` }).getAttribute('value')), { timeout: 30_000 }).toBeGreaterThan(0);
    }
    await expect(guest.getByRole('region', { name: 'グループ1の発言時間' })).toBeVisible();
    await page.getByText('セッション設定・グループ管理', { exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: '../docs/screenshots/public-speaker-host-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '../docs/screenshots/public-speaker-host-mobile.png', fullPage: true });
    await guest.setViewportSize({ width: 390, height: 844 });
    await guest.screenshot({ path: '../docs/screenshots/public-speaker-guest-mobile.png', fullPage: true });
    expect(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await guest.getByRole('button', { name: '録音を停止して端末に保管' }).click();
    await expect(guest.getByRole('button', { name: '録音は停止済みです' })).toBeVisible();
    await page.getByRole('button', { name: 'セッションを終える', exact: true }).click();
    await page.getByRole('button', { name: '終えて結果を見る', exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'ディスカッションの結果' })).toBeVisible();
    await guest.getByRole('link', { name: 'ホームに戻る', exact: true }).click();
    await expect(guest.locator('.mvp-session-link').filter({ hasText: '公開人声・実モデル接続確認' })).toContainText('終了');
  } finally { await context.close(); }
});
