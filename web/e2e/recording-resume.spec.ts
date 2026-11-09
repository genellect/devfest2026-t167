import { expect, test } from '@playwright/test';
import { loginStudent } from './student';

// 本番で起きたこと：録音担当の端末で録音が途中で止まり（画面が消えた・開き直したなど）、
// その議論の中で続きを録れず、議論が終わっても録音が送られなかった。
// 画面を開き直しても、端末に残った録音の続きを録れ、議論が終わると区間をまとめて送ることを確かめる。
test('録音中に画面を開き直しても、続きを録り、議論の終了後に区間をまとめて送る', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'テスト用の先生でログイン（エミュレータ）', includeHidden: true }).evaluate((element) => (element as HTMLButtonElement).click());
  await page.waitForURL(/\/home$/); await page.goto('/host/new');
  await page.getByLabel('テーマ', { exact: true }).fill('録音の再開のテスト');
  await page.getByRole('button', { name: '作成する', exact: true }).click();
  await expect(page).toHaveURL(/\/rooms\//);
  const code = (await page.getByTestId('join-code').textContent())!.replace(/\s/g, '');
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const guest = await context.newPage(); await loginStudent(guest);
    // 録音がまだ送られていないときの「ページを離れますか」は、開き直す（はい）を選ぶ
    guest.on('dialog', (dialog) => void dialog.accept());
    await guest.goto(`/join?code=${code}`); await expect(guest).toHaveURL(/\/rooms\//);
    await guest.getByLabel('参加者1の表示名').fill('架空の録音担当');
    await guest.getByRole('button', { name: '表示名を保存して進む' }).click();
    // 録音する部屋では、声の登録は必須（「あとで登録する」はない）
    await expect(guest.getByRole('heading', { name: '声の登録' })).toBeVisible();
    await expect(guest.getByRole('button', { name: 'あとで登録する' })).toHaveCount(0);
    await guest.getByLabel('声の特徴の登録と、上記の利用方法に同意します').check();
    await guest.getByRole('button', { name: '声を登録する', exact: true }).click();
    await expect(guest.getByRole('heading', { name: '議論の前に書く' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: '議論を開始', exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'グループで話し合いましょう' })).toBeVisible();

    const consent = () => guest.getByLabel('グループ全員が録音・声の照合・発言時間の集計に同意しました');
    await consent().check();
    await guest.getByRole('button', { name: '録音を始める', exact: true }).click();
    await expect(guest.getByRole('button', { name: '録音中', exact: true })).toBeVisible();
    // 端末への保存は15秒ごと。保存されたあとに画面を開き直す（録音はそこで止まる）
    await guest.waitForTimeout(17_000);
    await guest.reload();
    await expect(guest.getByRole('heading', { name: 'グループで話し合いましょう' })).toBeVisible();
    await expect(guest.getByText(/この端末に、ここまでの録音が残っています/)).toBeVisible();
    await guest.screenshot({ path: '../docs/screenshots/recording-resume-mobile.png', fullPage: true });
    await consent().check();
    await guest.getByRole('button', { name: '録音を再開する', exact: true }).click();
    await expect(guest.getByRole('button', { name: '録音中', exact: true })).toBeVisible();
    await guest.waitForTimeout(5_000);

    // 議論を終えると、録音担当の端末が、端末に残った区間と今の区間をまとめて1回で送る
    const sent = guest.waitForRequest((r) => r.url().includes('/groups/recording') && r.method() === 'POST');
    await page.getByRole('button', { name: '議論を終える', exact: true }).click();
    await page.getByRole('button', { name: '終えて結果を見る', exact: true }).click();
    expect(new URL((await sent).url()).searchParams.get('parts')?.split(',')).toHaveLength(2);
    await expect(guest.getByText('録音の送信・分析が完了しました。', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('分析済み 1/1グループ', { exact: true })).toBeVisible();
    // 送り終えた区間は端末から消す（画面を開き直しても、もう一度送らない）
    await guest.reload();
    await expect(guest.getByText(/録音を再送する|録音を送信して分析しています/)).toHaveCount(0);
  } finally { await context.close(); }
});
