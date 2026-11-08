import { expect, test, type Page } from "@playwright/test";
import { loginStudent } from "./student";
const sessions = [
  {sessionId:"history-ai",theme:"大学の課題に、AIを使ってもいい？",title:"AI",className:"総合探究",role:"participant",phase:"closed",ended:true},
  {sessionId:"history-city",theme:"10年後も暮らしたいまちって？",title:"まち",className:"社会",role:"host",phase:"closed",ended:true},
  {sessionId:"history-hidden",theme:"",title:"見せてはいけないテーマ",className:"ホームルーム",role:"participant",phase:"closed",ended:true},
];
async function login(page:Page) {
  if(process.env.T167_HISTORY_DEV_TEST !== "1") { await loginStudent(page); return; }
  await page.goto("/");
  await page.getByRole("button",{name:"Googleで続行",exact:true}).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("heading",{name:"あなたのホーム",exact:true})).toBeVisible();
}
async function fixture(page:Page) { await page.route("**/api/discussions",route=>route.fulfill({json:{sessions}})); }
test("履歴は一覧だけで検索でき、削除したスター・カード・目標を表示しない",async({page})=>{
  await fixture(page);await login(page);await page.goto("/history?view=starred");
  const list=page.getByRole("list",{name:"議論の履歴",exact:true});await expect(list.getByRole("listitem")).toHaveCount(3);
  await expect(page.getByText("テーマ非公開",{exact:true})).toBeVisible();await expect(page.getByText("見せてはいけないテーマ")).toHaveCount(0);
  const search=page.getByRole("searchbox",{name:"議論の履歴を検索"});await search.fill("社会");await expect(list.getByRole("listitem")).toHaveCount(1);await page.reload();await expect(list.getByRole("listitem")).toHaveCount(3);
  await expect(page.getByRole("button",{name:/スター|カード表示|リスト表示/})).toHaveCount(0);
});
test("読込失敗は空表示と区別し、再試行で復旧する",async({page})=>{
  let fail=true;await page.route("**/api/discussions",r=>r.fulfill(fail?{status:503,json:{error:{code:"unavailable",message:"Unavailable"}}}:{json:{sessions}}));
  await login(page);await page.goto("/history");await expect(page.getByRole("alert").filter({hasText:"履歴を読み込めません"})).toBeVisible();
  await expect(page.getByRole("heading",{name:"議論の履歴はありません",exact:true})).toHaveCount(0);
  fail=false;await page.getByRole("button",{name:"もう一度読み込む",exact:true}).click();await expect(page.getByRole("listitem")).toHaveCount(3);
});
test("履歴なし・検索一致なしを表示し、各端末幅で横にあふれない",async({page})=>{
  let items:typeof sessions=[];await page.route("**/api/discussions",r=>r.fulfill({json:{sessions:items}}));await login(page);await page.goto("/history");
  await expect(page.getByRole("heading",{name:"議論の履歴はありません",exact:true})).toBeVisible();items=sessions;await page.reload();
  for(const width of [320,393,820,1180,1440]) {
    await page.setViewportSize({width,height:900});await expect(page.getByRole("listitem")).toHaveCount(3);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await page.getByRole("searchbox",{name:"議論の履歴を検索"}).fill("見つからないテーマ");await expect(page.getByRole("heading",{name:"一致する議論がありません",exact:true})).toBeVisible();
});
test("サイドメニューはEscapeで閉じ、削除した項目を表示しない",async({page})=>{
  await fixture(page);await login(page);await page.goto("/history");
  const menu=page.getByRole("button",{name:"メニュー",exact:true});await menu.click();
  const drawer=page.getByRole("dialog",{name:"ホームのメニュー",exact:true});await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("link")).toHaveText(["ホーム", "履歴", "設定"]);
  await expect(drawer.getByText(/スター付き|学びの目標|最近の議論|アカウント/)).toHaveCount(0);
  await page.keyboard.press("Escape");await expect(menu).toBeFocused();expect(await page.evaluate(()=>document.body.style.overflow)).toBe("");
});
test("未ログインの履歴URLはログイン画面へ戻る",async({page})=>{
  await page.goto("/history?view=starred");await expect(page).toHaveURL(/\/$/);await expect(page.getByRole("button",{name:"Googleで続行",exact:true})).toBeVisible();
});

test("検索バーを最上部に置き、アカウントの入口は共通メニューに集約する", async ({ page }) => {
  await fixture(page); await login(page);
  for (const path of ["/home", "/history", "/settings"]) {
    await page.goto(path);
    const header = page.getByRole("banner");
    await expect(header.getByRole("link", { name: /アカウント設定|設定（/ })).toHaveCount(0);
    await header.getByRole("button", { name: "メニュー", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "ホームのメニュー", exact: true });
    await expect(drawer.getByRole("link")).toHaveText(["ホーム", "履歴", "設定"]);
    await page.keyboard.press("Escape");
    await expect(drawer).not.toBeVisible();
  }
  await page.goto("/history");
  const search = page.getByRole("searchbox", { name: "議論の履歴を検索" });
  await expect(search).toHaveAttribute("placeholder", "履歴を検索");
  expect(await page.getByRole("heading", { level: 1 }).evaluate(el => el.getBoundingClientRect().height)).toBe(1);
  await page.getByRole("button", { name: "メニュー", exact: true }).click();
  await page.getByRole("dialog", { name: "ホームのメニュー", exact: true }).getByRole("link", { name: "設定", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("link", { name: "ログイン端末", exact: true })).toBeVisible();
});
