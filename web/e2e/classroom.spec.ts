import { expect, test } from '@playwright/test';
import { loginStudent } from './student';
import { createHash } from 'node:crypto';
import { emulatorGoogleUser } from '../../firebase/emulator-auth.mjs';
async function loginGoogle(page: import('@playwright/test').Page, kind: 'teacher' | 'student') {
  if (kind === 'teacher') {
    const subject = `classroom-test-teacher-${createHash('sha256').update(`${test.info().testId}:${test.info().retry}`).digest('hex').slice(0, 20)}`;
    await emulatorGoogleUser('teacher', subject);
    await page.route(/identitytoolkit.*accounts:signInWithIdp/, async route => {
      const data = route.request().postDataJSON(), body = new URLSearchParams(data.postBody);
      const token = JSON.parse(body.get('id_token') ?? '{}');
      body.set('id_token', JSON.stringify({ ...token, sub: subject, email: `${subject}@example.com` }));
      await route.continue({ postData: JSON.stringify({ ...data, postBody: body.toString() }) });
    });
  }
  await page.getByRole('button', { name: kind === 'teacher' ? 'テスト用の先生でログイン（エミュレータ）' : 'テスト用の生徒でログイン（エミュレータ）', includeHidden: true }).evaluate(element => (element as HTMLButtonElement).click());
}
test.skip(process.env.NEXT_PUBLIC_CLASSROOM_MOCK !== '1', 'Classroomの明示モック環境だけで実行。実Googleへの接続試験とは分離する。');
test('クラスを選択して作成し、未利用者の名簿・参加・履歴まで反映する', async ({ page, browser }, testInfo) => {
  await page.goto('/'); await loginGoogle(page,'teacher'); await page.waitForURL('**/home');
  await page.getByRole('button',{name:'Classroomと連携',exact:true}).click();
  await expect(page.getByLabel('クラス',{exact:true})).toContainText('サンプル 探究学習');
  await page.getByRole('link',{name:'このクラスでホストする'}).click();
  const theme = `Classroom ${Date.now()}`;
  await page.getByLabel('テーマ',{exact:true}).fill(theme);
  await expect(page.getByRole('region', {name:'Classroomのクラス選択'}).getByLabel('クラス',{exact:true})).toHaveValue('mock-class-1');
  await page.getByRole('button',{name:'作成する',exact:true}).click();
  await page.waitForURL(/\/rooms\//); const roomUrl=page.url();
  const roster = page.getByRole('region',{name:'クラスの参加状況'});
  await roster.getByRole('button',{name:'名簿・参加状況を確認'}).click();
  await expect(roster).toContainText('参加済み 0／名簿 2人');
  const context=await browser.newContext({baseURL:new URL(page.url()).origin,viewport:{width:393,height:852}}); const student=await context.newPage();
  try {
    await student.goto('/'); await loginGoogle(student,'student'); await student.waitForURL('**/home');
    await student.getByRole('button',{name:'Classroomと連携',exact:true}).click();
    const row = student.getByRole('region',{name:'Classroomの話し合い'}).getByRole('listitem').filter({hasText:theme});
    await expect(row).toBeVisible(); await row.getByRole('button',{name:'参加する',exact:true}).click();
    await student.waitForURL(roomUrl);
    await roster.getByRole('button',{name:'名簿・参加状況を更新'}).click();
    await expect(roster).toContainText('参加済み 1／名簿 2人');
    await roster.screenshot({path:`../docs/screenshots/classroom-roster-${testInfo.project.name}.png`});
    await student.goto('/history'); await expect(student.locator('a.mvp-session-link').filter({hasText:theme})).toContainText('サンプル 探究学習');
  } finally { await context.close(); }
});
test('追加許可の拒否・学校の制限で通常参加を壊さず、再接続で復帰できる', async ({ page }) => {
  await page.goto('/'); await loginGoogle(page,'student'); await page.waitForURL('**/home');
  await page.route('**/api/integrations/classroom/courses', route=>route.fulfill({status:403,json:{error:{code:'google_permission',message:'学校のアクセス許可を確認してください'}}}));
  await page.getByRole('button',{name:'Classroomと連携',exact:true}).click();
  await expect(page.getByRole('region',{name:'Classroomの話し合い'}).getByRole('alert')).toContainText('学校のアクセス許可');
  await expect(page.getByRole('link',{name:'参加する',exact:true})).toBeEnabled();
  await page.unroute('**/api/integrations/classroom/courses');
  await page.getByRole('button',{name:'Classroomと連携',exact:true}).click();
  await expect(page.getByLabel('クラス',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'このタブの連携を終了'}).click();
  await expect(page.getByRole('button',{name:'Classroomと連携',exact:true})).toBeVisible();
});
test('空一覧と通信失敗を区別し、スマホ・タブレットでも横にはみ出さない', async ({ page },testInfo) => {
  await page.goto('/'); await loginGoogle(page,'student'); await page.waitForURL('**/home');
  await page.route('**/api/integrations/classroom/courses',route=>route.fulfill({json:{courses:[],syncedAt:Date.now()}}));
  await page.getByRole('button',{name:'Classroomと連携',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('所属している有効なクラスがありません');
  for (const width of [393, 820, 1440]) {
    await page.setViewportSize({width, height:1000});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await page.screenshot({path:`../docs/screenshots/classroom-empty-${testInfo.project.name}.png`,fullPage:true});
  await page.unroute('**/api/integrations/classroom/courses');
  await page.route('**/api/integrations/classroom/courses',route=>route.abort('failed'));
  await page.getByRole('button',{name:'クラス情報を更新',exact:true}).click();
  const region=page.getByRole('region',{name:'Classroomの話し合い'});
  await expect(region.getByRole('alert')).toBeVisible();
  await expect(region.getByText('所属している有効なクラスがありません。学校用のGoogleアカウントか確認してください。',{exact:true})).toHaveCount(0);
});

test('Classroom未連携でQRのURLを開いても、追加許可後にコードを維持して参加できる', async ({ page, browser }) => {
  await page.goto('/'); await loginGoogle(page, 'teacher'); await page.waitForURL('**/home');
  await page.getByRole('button', { name: 'Classroomと連携', exact: true }).click();
  await page.getByRole('link', { name: 'このクラスでホストする' }).click();
  await page.getByLabel('テーマ', { exact: true }).fill('クラスのQR参加');
  await expect(page.getByRole('region', {name:'Classroomのクラス選択'}).getByLabel('クラス', { exact: true })).toHaveValue('mock-class-1');
  await page.getByRole('button', { name: '作成する', exact: true }).click();
  await expect(page).toHaveURL(/\/rooms\//);
  const roomUrl = page.url(), code = (await page.getByTestId('join-code').textContent())!.replace(/\s/g, '');
  const context = await browser.newContext({ baseURL: new URL(roomUrl).origin });
  try {
    const guest = await context.newPage();
    await loginStudent(guest, 'classroom-qr');
    await guest.goto(`/join?code=${code}`);
    await guest.getByRole('button', { name: 'Classroomと連携して参加', exact: true }).click();
    await expect(guest).toHaveURL(roomUrl);
    await expect(guest.getByLabel('参加者1の表示名')).toBeVisible();
  } finally { await context.close(); }
});
