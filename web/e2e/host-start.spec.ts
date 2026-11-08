import { expect, test } from '@playwright/test';
import { loginGoogle } from './google';
import { loginStudent } from './student';
import { confirmFinish } from './finish';

test('Hostへの状態配信が遅れても開始成功後は参加者とともに議論画面へ進む', async ({ page, browser }) => {
  await page.addInitScript(() => {
    let paused = false;
    const release: (() => void)[] = [];
    Reflect.set(window, 't167PauseHostFeed', (value: boolean) => { paused = value; if (!value) release.splice(0).forEach(resolve => resolve()); });
    const read = ReadableStreamDefaultReader.prototype.read;
    ReadableStreamDefaultReader.prototype.read = async function (...args) {
      const value = await read.apply(this, args);
      if (paused && !value.done) await new Promise<void>(resolve => release.push(resolve));
      return value;
    };
  });
  await page.goto('/'); await loginGoogle(page, 'student', `host-delayed-${Date.now()}`);
  await page.waitForURL(/\/home$/); await page.goto('/host/new');
  await page.getByLabel('テーマ', { exact: true }).fill('ホストの状態更新が遅れた場合の確認');
  await page.getByRole('button', { name: 'セッションを作成', exact: true }).click();
  const code = (await page.getByTestId('join-code').textContent())!.replace(/\s/g, '');
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const guest = await context.newPage(); await loginStudent(guest); await guest.goto(`/join?code=${code}`);
    await guest.getByRole('button', { name: '1台を複数人で使う', exact: true }).click();
    await guest.getByLabel('参加者1の表示名').fill('参加者');
    await guest.getByRole('button', { name: '表示名を保存して進む', exact: true }).click();
    await expect(guest.getByRole('heading', { name: '参加できました', exact: true })).toBeVisible();
    await page.evaluate(() => Reflect.get(window, 't167PauseHostFeed')(true));
    const started = page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/phase') && r.request().method() === 'POST');
    await page.getByRole('button', { name: '議論を開始', exact: true }).click();
    expect((await started).status()).toBe(200);
    await expect(guest.getByRole('button', { name: '録音を始める', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'グループの状況', exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('join-code')).toHaveCount(0);
    await page.evaluate(() => Reflect.get(window, 't167PauseHostFeed')(false));
    await page.getByRole('button', { name: '議論を終える', exact: true }).click(); await confirmFinish(page);
  } finally {
    await page.evaluate(() => Reflect.get(window, 't167PauseHostFeed')(false)).catch(() => {});
    await context.close();
  }
});
