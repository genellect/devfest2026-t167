import { loginGoogle } from "./google";
import { expect, test } from '@playwright/test';
import { loginStudent } from './student';

test('録音と同じマイクで登録済みの声を照合し、Hostが表示を許可した場合だけGuestへ配信する', async ({ page, browser }) => {
  await page.goto('/');
  await loginGoogle(page, "teacher");
  await page.waitForURL(/\/home$/); await page.getByRole('link', { name: 'ホストする', exact: true }).click();
  await page.getByLabel('テーマ', { exact: true }).fill('合成マイクのテスト');
  await page.getByRole('button', { name: 'セッションを作成', exact: true }).click();
  await expect(page).toHaveURL(/\/rooms\//);
  const code = (await page.getByTestId('join-code').textContent())!.replace(/\s/g, '');
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const guest = await context.newPage(); await loginStudent(guest);
    await guest.goto(`/join?code=${code}`); await expect(guest).toHaveURL(/\/rooms\//);
    await guest.getByLabel('参加者1の表示名').fill('架空の参加者');
    await guest.getByRole('button', { name: '表示名を保存して進む' }).click();

    await guest.getByRole('button', { name: '声を登録する', exact: true }).click();
    await expect(guest.getByRole('heading', { name: '参加できました' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: '議論を開始', exact: true }).click();
    await expect(guest.getByRole('main', { name: '話し合い中', exact: true })).toBeVisible();
    await expect(guest.getByText('グループ全員が録音・声の照合・発言時間の集計に同意しました', { exact: true })).toHaveCount(0);
    await expect(guest.getByRole('button', { name: '録音を始める', exact: true })).toBeEnabled();
    await guest.getByRole('button', { name: '録音を始める', exact: true }).click();
    await page.getByRole('button', { name: 'グループ1の詳細を開く', exact: true }).click();
    const hostState = page.getByRole('region', { name: 'グループ1の発言時間', exact: true });
    await expect(hostState.getByText('直近の発言者：架空の参加者')).toBeVisible({ timeout: 15_000 });
    await expect(guest.getByRole('region', { name: 'グループ1の発言時間' })).toHaveCount(0);
    // 設定は歯車のボタンから開くダイアログにある
    await page.getByRole('button', { name: 'グループ詳細を閉じる', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'グループ1', exact: true })).not.toBeVisible();
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await page.getByLabel('参加者に所属グループの発言時間の推定を表示').check();
    await guest.getByRole('button', { name: '設定を開く', exact: true }).click();
    await expect(guest.getByRole('region', { name: 'グループ1の発言時間' })).toBeVisible();
    await page.getByLabel('参加者に所属グループの発言時間の推定を表示').uncheck();
    await expect(guest.getByRole('region', { name: 'グループ1の発言時間' })).toHaveCount(0);
    await page.getByRole('button', { name: '閉じる', exact: true }).click();
    await guest.getByRole('button', { name: '設定を閉じる', exact: true }).click();
    await guest.screenshot({ path: '../docs/screenshots/mvp-speaker-guest-mobile.png', fullPage: true });
    await page.screenshot({ path: '../docs/screenshots/mvp-speaker-host-mobile.png', fullPage: true });
    await page.getByRole('button', { name: '議論を終える', exact: true }).click();
    await page.getByRole('button', { name: '終えて結果を見る', exact: true }).click();
    await expect(guest.getByRole('heading', { name: '結論を自分の言葉で書く' })).toBeVisible();
    await expect(guest.getByRole('button', { name: '録音中', exact: true })).toHaveCount(0);
    await expect(guest.getByText('録音の送信・分析が完了しました。', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('分析済み 1/1グループ', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'グループ1の詳細を開く', exact: true }).click();
    const recorded = page.getByRole('region', { name: 'グループ1の録音分析', exact: true });
    await expect(recorded).toContainText('録音から話題の流れを読み取ります');
    await expect(recorded.getByRole('heading', { name: 'ホストへの助言', exact: true })).toBeVisible();
    await expect(recorded).toContainText('次回は記録係と進行役を交代し');
    await expect(page.getByRole('dialog', { name: 'グループ1', exact: true })).toContainText('架空の参加者');
    await page.getByRole('button', { name: 'グループ詳細を閉じる', exact: true }).click();
    await page.reload();
    await page.getByRole('button', { name: 'グループ1の詳細を開く', exact: true }).click();
    await expect(page.getByRole('region', { name: 'グループ1の録音分析', exact: true })).toContainText('次回は記録係と進行役を交代し');
  } finally { await context.close(); }
});
