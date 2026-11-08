import { expect, type Page } from '@playwright/test';
/** 終了は非同期操作。APIが成功してから、参加者へ状態が配信されることを検査する。 */
export async function confirmFinish(page:Page){
  const completed=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/finish')&&response.request().method()==='POST',{timeout:25000});
  await page.getByRole('button',{name:'終えて結果を見る',exact:true}).click();
  expect((await completed).status()).toBe(200);
}
