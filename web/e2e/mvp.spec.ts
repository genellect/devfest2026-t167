import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
import QRCode from 'qrcode';
import { mkdir } from 'node:fs/promises';

const authUrl = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099'}/identitytoolkit.googleapis.com/v1/accounts:`;
async function tokenFor(email: string) {
  const data = { email, password: 'password', returnSecureToken: true }; // submit-allow: エミュレータ専用のダミー
  await fetch(`${authUrl}signUp?key=fake`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  const response = await fetch(`${authUrl}signInWithPassword?key=fake`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  const value = await response.json(); expect(value.idToken).toBeTruthy(); return value.idToken as string;
}
const headersFor = (token: string) => ({ authorization: `Bearer ${token}` });
const settings = { title: 'MVPデモ：AIとの学び方', theme: '授業でAIをどこまで活用する？', groups: 1, minutes: 1, recording: true, visible: { theme: true, timer: true, members: true }, publishOnEnd: true };
async function login(page: Page, host = false) {
  await page.goto('/home');
  await page.getByRole('button', { name: host ? 'テスト用の先生でログイン（エミュレータ）' : 'テスト用の生徒でログイン（エミュレータ）', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ホーム', exact: true })).toBeVisible();
}
async function fixture(request: APIRequestContext, overrides: object = {}) {
  const token = await tokenFor(`host-${Date.now()}-${Math.random()}@example.com`), headers = headersFor(token);
  const response = await request.post('/api/discussions/create', { headers, data: { ...settings, ...overrides } }); expect(response.status()).toBe(201);
  const { id } = await response.json(); const room = await (await request.get(`/api/discussions/room/${id}`, { headers })).json();
  return { id: id as string, code: room.code as string, headers };
}
function voiceFile() {
  const seconds = 9, count = seconds * 16000, wav = Buffer.alloc(44 + count * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) wav.writeInt16LE(Math.round(5000 * Math.sin(i * 0.07)), 44 + i * 2);
  return { name: 'voice.wav', mimeType: 'audio/wav', buffer: wav };
}
async function guest(page: Page, code: string, options: { shared?: boolean; microphone?: boolean } = {}) {
  await login(page);
  await page.goto(`/join?code=${code}`); await page.getByRole('button', { name: '参加する', exact: true }).click();
  if (options.shared) await page.getByLabel('参加する端末').selectOption('shared');
  await page.getByLabel('参加者1の表示名').fill('架空のGuest A');
  if (options.shared) { await page.getByRole('button', { name: '参加者を追加', exact: true }).click(); await page.getByLabel('参加者2の表示名').fill('架空のGuest B'); }
  await page.getByRole('button', { name: '表示名を保存して進む' }).click();
  await expect(page.getByRole('heading', { name: '初回の音声登録' })).toBeVisible();
  await page.getByLabel('声の特徴の登録と利用に同意します').check();
  if (options.microphone) await page.getByRole('button', { name: '声を登録する', exact: true }).first().click();
  else await page.getByLabel('架空のGuest Aの登録用音声ファイル').setInputFiles(voiceFile());
  if (options.shared) { await expect(page.getByRole('button', { name: '登録済み', exact: true })).toHaveCount(1); await page.getByLabel('架空のGuest Bの登録用音声ファイル').setInputFiles(voiceFile()); }
  await expect(page.getByRole('heading', { name: '待機画面' })).toBeVisible({ timeout: 20000 });
}
test.beforeEach(async ({ request }) => {
  await tokenFor('mod@example.com'); const student = await tokenFor('p1@example.com');
  await request.post('/api/discussions/voice/delete', { headers: headersFor(student), data: {} });
});

test('未ログインのコード・作成画面でもGoogleログインを要求し、API転送を確認する', async ({ page, request }) => {
  for (const path of ['/join?code=ABC123', '/host/new', '/participate']) { await page.goto(path); await expect(page.getByRole('button', { name: 'Googleでログイン', exact: true })).toBeVisible(); }
  for (const path of ['/api/health', '/api/healthz']) { expect(await (await request.get(path)).json()).toEqual({ ok: true, gemini: 'mock' }); }
});
test('共通ホームからHostとして設定・作成し、スマホとPCで表示できる', async ({ page }) => {
  await login(page, true); await page.getByRole('link', { name: '参加する', exact: true }).click(); await page.getByRole('link', { name: 'ホスト', exact: true }).click();
  await page.getByLabel('セッション名').fill(settings.title); await page.getByLabel('テーマ', { exact: true }).fill(settings.theme); await page.getByLabel('制限時間（分）').fill('1'); await page.getByRole('button', { name: '部屋を作る', exact: true }).click();
  await expect(page.getByRole('heading', { name: '参加コードとQR' })).toBeVisible(); await expect(page.getByRole('button', { name: 'ディスカッションを開始' })).toBeDisabled();
  await page.getByText('セッション設定', { exact: true }).click(); await page.getByLabel('テーマ', { exact: true }).fill('変更後のテーマ'); await page.getByRole('button', { name: '設定を保存', exact: true }).click();
  await expect(page.getByLabel('テーマ', { exact: true })).toHaveValue('変更後のテーマ'); await page.getByText('セッション設定', { exact: true }).click();
  await mkdir('../docs/screenshots', { recursive: true });
  await page.screenshot({ path: '../docs/screenshots/mvp-demo-host-mobile.png', fullPage: true }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.screenshot({ path: '../docs/screenshots/mvp-demo-host-desktop.png', fullPage: true });
  await page.getByRole('link', { name: 'ホームに戻る' }).click(); await expect(page.locator('.mvp-session-link').filter({ hasText: settings.title }).first()).toContainText('Host');
});
test('QR画像と手入力の参加コードを読み取り、誤ったコードを修正できる', async ({ page, request }) => {
  const f = await fixture(request); await login(page); await page.goto('/join');
  await page.getByLabel('参加コード', { exact: true }).fill('zz-zz zz'); await expect(page.getByLabel('参加コード', { exact: true })).toHaveValue('ZZZZZZ'); await page.getByRole('button', { name: '参加する', exact: true }).click(); await expect(page.locator('main [role="alert"]')).toContainText('見つかりません');
  await page.getByRole('button', { name: 'QRで参加', exact: true }).click(); const origin = new URL(page.url()).origin;
  await page.getByLabel('QRを撮影または画像を選択').setInputFiles({ name: 'join.png', mimeType: 'image/png', buffer: await QRCode.toBuffer(`${origin}/join?code=${f.code}`) });
  await expect(page.getByLabel('参加コード', { exact: true })).toHaveValue(f.code); await page.getByRole('button', { name: '参加する', exact: true }).click(); await expect(page.getByRole('heading', { name: '表示名を設定' })).toBeVisible();
});
test('共有端末は全員を登録して待機し、Host終了後に未公開の結果を隠す', async ({ page, request }) => {
  const f = await fixture(request, { recording: false, publishOnEnd: false }); await guest(page, f.code, { shared: true });
  await page.reload(); await expect(page.getByRole('heading', { name: '待機画面' })).toBeVisible();
  expect((await request.post(`/api/discussions/room/${f.id}/start`, { headers: f.headers, data: {} })).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'グループで話し合いましょう' })).toBeVisible();
  await request.post(`/api/discussions/room/${f.id}/settings`, { headers: f.headers, data: { visible: { theme: false, timer: false, members: false } } });
  await expect(page.getByText(`テーマ：${settings.theme}`)).toHaveCount(0); await expect(page.getByRole('timer')).toHaveCount(0);
  await request.post(`/api/discussions/room/${f.id}/finish`, { headers: f.headers, data: {} }); await expect(page.getByText('結果はHostの公開後に表示されます。')).toBeVisible();
  await request.post(`/api/discussions/room/${f.id}/settings`, { headers: f.headers, data: { published: true } }); await expect(page.getByText('録音しなかったため、音声の分析結果はありません。')).toBeVisible();
});
test('個人の初回マイク登録から録音・Host終了・自動送信・分析結果・ホームまで通す', async ({ page, browser, request }) => {
  const context = await browser.newContext({ baseURL: new URL(page.url() === 'about:blank' ? test.info().project.use.baseURL! : page.url()).origin });
  try {
    const host = await context.newPage(); await login(host, true); await host.goto('/host/new');
    await host.getByLabel('セッション名').fill('録音を含むMVPデモ'); await host.getByLabel('テーマ', { exact: true }).fill(settings.theme); await host.getByLabel('制限時間（分）').fill('1'); await host.getByRole('button', { name: '部屋を作る', exact: true }).click();
    const code = (await host.getByTestId('join-code').textContent())!.trim();
    await guest(page, code, { microphone: true });
    await host.getByRole('button', { name: 'ディスカッションを開始', exact: true }).click(); await expect(page.getByRole('heading', { name: 'グループで話し合いましょう' })).toBeVisible();
    await expect(page.getByRole('button', { name: '録音を始める' })).toBeDisabled(); await page.getByLabel('グループ全員が録音とAI分析に同意しました').check(); await page.getByRole('button', { name: '録音を始める' }).click();
    await expect(page.getByRole('status').filter({ hasText: '録音中' })).toBeVisible(); await page.waitForTimeout(2500);
    await page.screenshot({ path: '../docs/screenshots/mvp-demo-guest-mobile.png', fullPage: true });
    await host.getByRole('button', { name: 'ディスカッションを終了', exact: true }).click(); await host.getByRole('button', { name: '終了して結果を見る' }).click();
    await expect(page.getByText('録音の送信・分析が完了しました。')).toBeVisible({ timeout: 20000 }); await expect(page.getByRole('heading', { name: '議論の流れ', exact: true })).toBeVisible(); await expect(host.getByText('分析済み 1/1グループ。未分析の内容は推測で補いません。')).toBeVisible();
    await page.screenshot({ path: '../docs/screenshots/mvp-demo-result-mobile.png', fullPage: true }); await page.getByRole('link', { name: 'ホームに戻る' }).click(); await expect(page.getByRole('heading', { name: 'ホーム', exact: true })).toBeVisible();
    const f = await fixture(request, { recording: false }); await page.goto(`/join?code=${f.code}`); await page.getByRole('button', { name: '参加する', exact: true }).click(); await page.getByLabel('参加者1の表示名').fill('次回のGuest'); await page.getByRole('button', { name: '表示名を保存して進む' }).click(); await expect(page.getByRole('heading', { name: '待機画面' })).toBeVisible();
  } finally { await context.close(); }
});
test('録音送信に失敗しても再読込で音声を回収し、再送できる', async ({ page, request }) => {
  const f = await fixture(request); await guest(page, f.code); await request.post(`/api/discussions/room/${f.id}/start`, { headers: f.headers, data: {} });
  await page.getByLabel('グループ全員が録音とAI分析に同意しました').check(); await page.getByRole('button', { name: '録音を始める' }).click(); await expect(page.getByRole('status').filter({ hasText: '録音中' })).toBeVisible(); await page.waitForTimeout(1500);
  await page.route('**/api/discussions/room/*/recording?*', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: '試験用の接続失敗' } }) }));
  await request.post(`/api/discussions/room/${f.id}/finish`, { headers: f.headers, data: {} }); await expect(page.getByRole('button', { name: '録音を再送する' })).toBeVisible(); await expect(page.getByRole('link', { name: '録音をダウンロードして保管' })).toBeVisible();
  page.on('dialog', (dialog) => dialog.accept()); await page.reload(); await expect(page.getByRole('button', { name: '録音を再送する' })).toBeVisible();
  await page.unroute('**/api/discussions/room/*/recording?*'); await page.getByRole('button', { name: '録音を再送する' }).click(); await expect(page.getByText('録音の送信・分析が完了しました。')).toBeVisible();
});
test('音声登録のマイク拒否を表示し、同意なしの登録を防ぐ', async ({ page, request }) => {
  const f = await fixture(request); await login(page); await page.goto(`/join?code=${f.code}`); await page.getByRole('button', { name: '参加する', exact: true }).click(); await page.getByLabel('参加者1の表示名').fill('マイク拒否'); await page.getByRole('button', { name: '表示名を保存して進む' }).click();
  await expect(page.getByRole('button', { name: '声を登録する', exact: true })).toBeDisabled();
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('マイクが拒否されました', 'NotAllowedError'); }; });
  await page.getByLabel('声の特徴の登録と利用に同意します').check(); await page.getByRole('button', { name: '声を登録する', exact: true }).click(); await expect(page.locator('main [role="alert"]')).toContainText('拒否');
});
test('同じ利用者が別セッションでHostとGuestを兼任できる', async ({ page, request }) => {
  await login(page, true); const f = await fixture(request, { recording: false }); await page.goto(`/join?code=${f.code}`); await page.getByRole('button', { name: '参加する', exact: true }).click(); await expect(page.getByRole('heading', { name: '表示名を設定' })).toBeVisible();
  await page.getByRole('link', { name: 'ホームに戻る' }).click(); await expect(page.locator('.mvp-session-link').filter({ hasText: settings.title }).first()).toContainText('Guest');
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
