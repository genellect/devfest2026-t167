import {expect,test} from '@playwright/test';
import {loginGoogle} from '../e2e/google';
import {loginStudent} from '../e2e/student';
import {confirmFinish} from '../e2e/finish';

test('公開音声のブラウザ録音→実Gemini文字起こし→Host分析→終了後の公開結果',async({page,browser},info)=>{
  await page.goto('/'); await loginGoogle(page,'teacher',`real-audio-${Date.now()}`);
  await page.waitForURL(/\/home$/); await page.goto('/host/new');
  await page.getByLabel('テーマ',{exact:true}).fill('公開音声サンプルの動作確認。観測できない議論や協働を推測しない');
  await page.getByRole('button',{name:'セッションを作成',exact:true}).click();
  const code=(await page.getByTestId('join-code').textContent())!.replace(/\s/g,'');
  const context=await browser.newContext({baseURL:new URL(page.url()).origin});
  try{
    const guest=await context.newPage(); await loginStudent(guest);await guest.goto(`/join?code=${code}`);
    await guest.getByRole('button',{name:'1台を複数人で使う',exact:true}).click();
    await guest.getByLabel('参加者1の表示名').fill('公開音声サンプル');
    await guest.getByRole('button',{name:'表示名を保存して進む',exact:true}).click();
    await expect(guest.getByRole('heading',{name:'参加できました',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'議論を開始',exact:true}).click();
    const transcript=guest.waitForResponse(r=>r.url().includes('/transcripts/audio?'),{timeout:60000});
    await guest.getByRole('button',{name:'録音を始める',exact:true}).click();
    expect((await transcript).status()).toBe(200);
    await page.getByRole('button',{name:'グループ1の詳細を開く',exact:true}).click();
    const live=page.getByRole('heading',{name:'音声内容の振り返り',exact:false}).locator('..');
    await expect(live.getByText('発言から読み取れたこと',{exact:true})).toBeVisible({timeout:60000});
    await expect(live.getByText('デモデータ')).toHaveCount(0);
    await page.screenshot({path:info.outputPath('real-gemini-host-analysis.png')});
    await page.getByRole('button',{name:'グループ詳細を閉じる',exact:true}).click();
    const recording=guest.waitForResponse(r=>r.url().includes('/groups/recording?'),{timeout:120000});
    await page.getByRole('button',{name:'議論を終える',exact:true}).click();await confirmFinish(page);
    expect((await recording).status()).toBe(200);
    await expect(guest.getByText('録音の送信・分析が完了しました。',{exact:true})).toBeVisible();
    await expect(guest.getByRole('heading',{name:'あなたの振り返り',exact:false})).toBeVisible();
    await expect(guest.getByRole('heading',{name:'音声内容の振り返り',exact:false})).toBeVisible();
    await guest.getByLabel('グループの結論を、あなたはどう理解した？',{exact:true}).fill('公開サンプルには発話があるが、協働や合意の有無はこの音声だけでは判断できない。');
    await guest.getByRole('button',{name:'どちらともいえない',exact:true}).click();
    await guest.getByRole('button',{name:'提出する',exact:true}).click();
    await expect(guest.getByRole('heading',{name:'同じ結論を、どう理解した？',exact:true})).toBeVisible({timeout:60000});
    await expect(guest.getByRole('heading',{name:'グループで何が起きたか',exact:true})).toBeVisible();
    await guest.screenshot({path:info.outputPath('real-gemini-published-result.png'),fullPage:true});
    await guest.getByRole('link',{name:'ホームに戻る',exact:true}).click();await expect(guest).toHaveURL(/\/home$/);
  }finally{await context.close();}
});
