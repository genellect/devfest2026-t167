import { confirmFinish } from "./finish";
import { expect, test } from '@playwright/test';
import { loginGoogle } from './google';
import { loginStudent } from './student';

test('録音から文字起こし・グループ内容分析・公開済み結果の表示まで接続する（Geminiはモック）',async({page,browser},info)=>{
  await page.goto('/');await loginGoogle(page,'teacher','transcript-host');await page.waitForURL(/\/home$/);await page.goto('/host/new');
  await page.getByLabel('テーマ',{exact:true}).fill('音声からの分析接続');await page.getByRole('button',{name:'セッションを作成',exact:true}).click();
  const code=(await page.getByTestId('join-code').textContent())!.replace(/\s/g,'');
  const context=await browser.newContext({baseURL:new URL(page.url()).origin});
  try{
    const guest=await context.newPage();await loginStudent(guest);await guest.goto(`/join?code=${code}`);
    await guest.getByRole('button',{name:'1台を複数人で使う',exact:true}).click();await guest.getByLabel('参加者1の表示名').fill('匿名集計の参加者');await guest.getByRole('button',{name:'表示名を保存して進む',exact:true}).click();
    await expect(guest.getByRole('heading',{name:'参加できました',exact:true})).toBeVisible();await page.getByRole('button',{name:'議論を開始',exact:true}).click();
    const transcript=guest.waitForResponse(r=>r.url().includes('/transcripts/audio?'),{timeout:25000});
    await guest.getByRole('button',{name:'録音を始める',exact:true}).click();expect((await transcript).ok()).toBe(true);
    await page.getByRole('button',{name:'グループ1の詳細を開く',exact:true}).click();
    await expect(page.getByText('発言を根拠にした観察（デモデータ）').first()).toBeVisible({timeout:25000});
    await page.screenshot({path:info.outputPath('transcript-group-analysis.png')});
    let uploads=0;await guest.route('**/api/rooms/*/groups/recording?*',route=>{uploads++;return uploads===1?route.fulfill({status:503,json:{error:{code:'gemini_unavailable',message:'Temporary test failure'}}}):route.continue();});
    await page.getByRole('button',{name:'グループ詳細を閉じる',exact:true}).click();await page.getByRole('button',{name:'議論を終える',exact:true}).click();await confirmFinish(page);
    await expect(guest.getByText('発言を根拠にした観察（デモデータ）').first()).toBeVisible();
    await expect(guest.getByRole('heading',{name:'あなたの振り返り',exact:false})).toBeVisible();
    await expect(guest.getByText('録音の送信・分析が完了しました。',{exact:true})).toBeVisible({timeout:20000});expect(uploads).toBe(2);
    await guest.screenshot({path:info.outputPath('published-voice-analysis.png')});
  }finally{await context.close();}
});
