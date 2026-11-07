import { expect, test } from '@playwright/test';
import { loginStudent } from './student';

test('録音と同じマイクで登録済みの声を照合し、Hostが表示を許可した場合だけGuestへ配信する', async ({ page, browser }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'テスト用の先生でログイン（エミュレータ）' }).click();
  await page.waitForURL(/\/teacher$/); await page.goto('/host/new');
  await page.getByLabel('テーマ', { exact: true }).fill('合成マイクのテスト');
  await page.getByRole('button', { name: '作成する', exact: true }).click();
  await expect(page).toHaveURL(/\/rooms\//);
  const code = (await page.getByTestId('join-code').textContent())!.replace(/\s/g, '');
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const guest = await context.newPage(); await loginStudent(guest);
    await guest.goto(`/join?code=${code}`); await expect(guest).toHaveURL(/\/rooms\//);
    await guest.getByLabel('参加者1の表示名').fill('架空の参加者');
    await guest.getByRole('button', { name: '表示名を保存して進む' }).click();
    await guest.getByLabel('声の特徴の登録と、上記の利用方法に同意します').check();
    await guest.getByRole('button', { name: '声を登録する', exact: true }).click();
    await expect(guest.getByRole('heading', { name: '議論の前に書く' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: '議論を開始', exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'グループで話し合いましょう' })).toBeVisible();
    await expect(guest.getByLabel('グループ全員が録音・声の照合・発言時間の集計に同意しました')).not.toBeChecked();
    await expect(guest.getByRole('button', { name: '録音を始める', exact: true })).toBeDisabled();
    await guest.getByLabel('グループ全員が録音・声の照合・発言時間の集計に同意しました').check();
    await guest.getByRole('button', { name: '録音を始める', exact: true }).click();
    const hostState = page.getByRole('region', { name: 'グループ1の発言時間', exact: true });
    await expect(hostState.getByText('直近の発言者：架空の参加者')).toBeVisible({ timeout: 15_000 });
    await expect(guest.getByRole('region', { name: 'グループ1の発言時間' })).toHaveCount(0);
    // 設定は歯車のボタンから開くダイアログにある
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await page.getByLabel('参加者に所属グループの発言時間の推定を表示').check();
    await expect(guest.getByRole('region', { name: 'グループ1の発言時間' })).toBeVisible();
    await page.getByLabel('参加者に所属グループの発言時間の推定を表示').uncheck();
    await expect(guest.getByRole('region', { name: 'グループ1の発言時間' })).toHaveCount(0);
    await page.getByRole('button', { name: '閉じる', exact: true }).click();
    await guest.screenshot({ path: '../docs/screenshots/mvp-speaker-guest-mobile.png', fullPage: true });
    await page.screenshot({ path: '../docs/screenshots/mvp-speaker-host-mobile.png', fullPage: true });
    await page.getByRole('button', { name: '議論を終える', exact: true }).click();
    await page.getByRole('button', { name: '終えて結果を見る', exact: true }).click();
    await expect(guest.getByRole('heading', { name: '結論を自分の言葉で書く' })).toBeVisible();
    await expect(guest.getByRole('button', { name: '録音中', exact: true })).toHaveCount(0);
    await expect(guest.getByText('録音の送信・分析が完了しました。', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('分析済み 1/1グループ', { exact: true })).toBeVisible();
  } finally { await context.close(); }
});
