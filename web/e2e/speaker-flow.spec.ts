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
  const peerContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const guest = await context.newPage(); await loginStudent(guest);
    await guest.goto(`/join?code=${code}`); await expect(guest).toHaveURL(/\/rooms\//);
    await guest.getByLabel('参加者1の表示名').fill('架空の参加者');
    await guest.getByRole('button', { name: '表示名を保存して進む' }).click();
    await guest.getByRole('button', { name: '声を登録する', exact: true }).click();
    await expect(guest.getByRole('heading', { name: '議論の前に書く' })).toBeVisible({ timeout: 20_000 });
    // 同じグループのもう1人（声は登録しない）。録音の担当がだれかを、この人の画面で確かめる
    const peer = await peerContext.newPage(); await loginStudent(peer, 'peer');
    await peer.goto(`/join?code=${code}`); await expect(peer).toHaveURL(/\/rooms\//);
    await peer.getByLabel('参加者1の表示名').fill('となりの参加者');
    await peer.getByRole('button', { name: '表示名を保存して進む' }).click();
    await peer.getByRole('button', { name: 'あとで登録する', exact: true }).click();
    await page.getByRole('button', { name: '議論を開始', exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'グループで話し合いましょう' })).toBeVisible();
    await expect(guest.getByRole('checkbox')).toHaveCount(0);
    await guest.getByRole('button', { name: '設定', exact: true }).click();
    await expect(guest.getByRole('button', { name: '録音を始める', exact: true })).toBeEnabled();
    await guest.getByRole('button', { name: '録音を始める', exact: true }).click();
    // 録音を始めた端末が担当になり、ほかの人と教員の画面に担当の名前が出る
    await expect(guest.getByRole('heading', { name: '録音（この端末が担当）', exact: true })).toBeVisible();
    await expect(peer.getByText('録音担当：架空の参加者さん', { exact: true })).toBeVisible();
    await peer.getByRole('button', { name: '設定', exact: true }).click();
    await expect(peer.getByRole('button', { name: '録音を始める', exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'グループの状況' }).getByText(/録音担当：架空の参加者さん/)).toBeVisible();
    await page.getByRole('button', { name: 'グループ1の詳細', exact: true }).click();
    const hostState = page.getByRole('region', { name: 'グループ1の発言時間', exact: true });
    await expect(hostState.getByText('直近の発言者：架空の参加者')).toBeVisible({ timeout: 15_000 });
    await expect(guest.getByRole('region', { name: 'グループ1の発言時間' })).toHaveCount(0);
    await page.getByRole('dialog', { name: 'グループ1', exact: true }).getByRole('button', { name: '閉じる', exact: true }).click();
    // 設定はボタンから開くダイアログにある
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await page.getByLabel('参加者に所属グループの発言時間の推定を表示').check();
    await expect(guest.getByRole('region', { name: 'グループ1の発言時間' })).toBeVisible();
    await page.getByLabel('参加者に所属グループの発言時間の推定を表示').uncheck();
    await expect(guest.getByRole('region', { name: 'グループ1の発言時間' })).toHaveCount(0);
    await page.getByLabel('参加者に所属グループの発言時間の推定を表示').check();
    await expect(guest.getByRole('region', { name: 'グループ1の発言時間' })).toBeVisible();
    await page.getByRole('button', { name: '閉じる', exact: true }).click();
    await guest.screenshot({ path: '../docs/screenshots/mvp-speaker-guest-mobile.png', fullPage: true });
    await page.screenshot({ path: '../docs/screenshots/mvp-speaker-host-mobile.png', fullPage: true });
    await page.getByRole('button', { name: '議論を終える', exact: true }).click();
    await page.getByRole('button', { name: '終了する', exact: true }).click();
    await expect(guest.getByRole('heading', { name: '結論を自分の言葉で書く' })).toBeVisible();
    await expect(guest.getByRole('button', { name: '録音中', exact: true })).toHaveCount(0);
    await expect(guest.getByText('録音の送信・分析が完了しました。', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('分析済み 1/1グループ', { exact: true })).toBeVisible();
    for (const person of [guest, peer]) {
      await person.getByLabel('グループの結論を、あなたはどう理解した？').fill('使った場所を伝えるルールを作る。');
      await person.getByRole('button', { name: '4 おおむね納得', exact: true }).click();
      await person.getByRole('button', { name: '提出する', exact: true }).click();
    }
    const ownTime = guest.getByRole('region', { name: 'あなたの発言時間', exact: true });
    await expect(ownTime).toBeVisible();
    await expect.poll(async () => Number(await ownTime.getByRole('progressbar', { name: '架空の参加者の発言率' }).getAttribute('value'))).toBeGreaterThan(0);
  } finally { await Promise.all([context.close(), peerContext.close()]); }
});
