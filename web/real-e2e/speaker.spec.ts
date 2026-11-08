import {expect,test} from '@playwright/test';
import {resolve} from 'node:path';
import {loginGoogle} from '../e2e/google';
import {loginStudent} from '../e2e/student';
import {confirmFinish} from '../e2e/finish';

test('公開人声を個人端末へ登録し、別区間のマイク入力を実モデルで名前に対応付ける',async({page,browser},info)=>{
  await page.goto('/');await loginGoogle(page,'teacher',`public-speaker-${Date.now()}`);
  await page.waitForURL(/\/home$/);await page.goto('/host/new');
  await page.getByLabel('テーマ',{exact:true}).fill('公開音声の登録・識別の確認');
  await page.getByRole('button',{name:'セッションを作成',exact:true}).click();
  const code=(await page.getByTestId('join-code').textContent())!.replace(/\s/g,'');
  const context=await browser.newContext({baseURL:new URL(page.url()).origin});
  try{
    const guest=await context.newPage();await loginStudent(guest);await guest.goto(`/join?code=${code}`);
    await guest.getByLabel('参加者1の表示名').fill('公開音声A');
    await guest.getByRole('button',{name:'表示名を保存して進む',exact:true}).click();
    const folder=process.env.SPEAKER_PUBLIC_SAMPLE_DIR??resolve('../.local-data/public-voices');
    await guest.getByLabel('公開音声Aの登録用音声ファイル').setInputFiles(resolve(folder,'speaker-1-enroll.wav'));
    await expect(guest.getByRole('heading',{name:'参加できました',exact:true})).toBeVisible({timeout:20000});
    await page.getByRole('button',{name:'設定',exact:true}).click();
    await page.getByLabel('参加者に所属グループの発言時間の推定を表示').check();
    await page.getByRole('button',{name:'閉じる',exact:true}).click();
    await page.getByRole('button',{name:'議論を開始',exact:true}).click();
    await guest.getByRole('button',{name:'録音を始める',exact:true}).click();
    await page.getByRole('button',{name:'グループ1の詳細を開く',exact:true}).click();
    const rates=page.getByRole('region',{name:'グループ1の発言時間',exact:true});
    await expect(rates.getByText('実音声モデルによる推定',{exact:true})).toBeVisible();
    const row=rates.locator('dl > div').filter({has:page.getByText('公開音声A',{exact:true})});
    await expect.poll(async()=>await row.count()?Number.parseFloat((await row.locator('dd small').textContent())??'0'):0,{timeout:45000}).toBeGreaterThan(0);
    await guest.getByRole('button',{name:'設定を開く',exact:true}).click();
    await expect(guest.getByRole('region',{name:'グループ1の発言時間',exact:true})).toContainText('公開音声A');
    await guest.getByRole('button',{name:'設定を閉じる',exact:true}).click();
    await page.screenshot({path:info.outputPath('public-speaker-host.png'),fullPage:true});
    await page.getByRole('button',{name:'グループ詳細を閉じる',exact:true}).click();
    await page.getByRole('button',{name:'議論を終える',exact:true}).click();await confirmFinish(page);
    await expect(guest.getByText('録音の送信・分析が完了しました。',{exact:true})).toBeVisible({timeout:120000});
  }finally{await context.close();}
});
