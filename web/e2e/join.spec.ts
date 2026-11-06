import { expect, test } from "@playwright/test";

// 司会者が部屋を作り、参加者がスマホで参加コードを入れて参加し、非公開の意見を出せるところまで
import { emulatorGoogleUser } from "../../firebase/emulator-auth.mjs";
async function moderatorToken(): Promise<string> {
  return (await emulatorGoogleUser("teacher", `e2e-${Date.now()}`)).idToken;
}

test("/api は Cloud Run 役の API に転送される", async ({ request }) => {
  for (const path of ["/api/healthz", "/api/health"]) {
    const res = await request.get(path);
    expect(res.ok()).toBeTruthy();
    expect(await res.json()).toEqual({ ok: true, gemini: "mock" });
  }
});

test("参加コードで参加し、非公開の意見を出すと、グループがそろって議論が始まる", async ({ page, request }) => {
  const created = await request.post("/api/rooms", {
    headers: { authorization: `Bearer ${await moderatorToken()}` },
    data: { title: "大学における生成AI利用の是非" },
  });
  expect(created.status()).toBe(201);
  const { joinCode } = await created.json();

  await page.goto("/");
  await page.getByRole("link", { name: "参加コードを入力" }).click();
  await page.getByLabel("参加コード").fill(joinCode);
  await page.getByRole("button", { name: "テスト用の生徒でログイン（エミュレータ）" }).click();
  await page.getByRole("button", { name: "参加する" }).click();

  await expect(page.getByRole("heading", { name: "大学における生成AI利用の是非" })).toBeVisible();
  await expect(page.getByTestId("phase")).toHaveText("事前意見の受付中");
  await page.getByLabel("あなたの意見").fill("AI を使ったことを申告するルールが必要");
  await page.getByRole("button", { name: "提出する" }).click();
  // グループ（この部屋は1グループ・1人）の全員の意見がそろったので、議論の画面に自動で変わる
  await expect(page.getByRole("heading", { name: "グループで話し合いましょう" })).toBeVisible();
});

test("全員の同意を確かめて録音し、議論を終えると録音が分析され、結果に議論の流れが出る", async ({ page, request }) => {
  const created = await request.post("/api/rooms", {
    headers: { authorization: `Bearer ${await moderatorToken()}` },
    data: { title: "部活動の時間を短くするべきか" },
  });
  const { joinCode } = await created.json();
  await page.goto(`/join?code=${joinCode}`);
  await page.getByRole("button", { name: "テスト用の生徒でログイン（エミュレータ）" }).click();
  await page.getByRole("button", { name: "参加する" }).click();
  await page.getByLabel("あなたの意見").fill("練習の質を上げれば短くてもよい");
  await page.getByRole("button", { name: "提出する" }).click();
  await expect(page.getByRole("heading", { name: "グループで話し合いましょう" })).toBeVisible();

  // 同意するまでは録音を始められない
  const start = page.getByRole("button", { name: "録音を始める" });
  await expect(start).toBeDisabled();
  await page.getByLabel("グループ全員が、録音することに同意しました").check();
  await start.click();
  await expect(page.getByText(/^録音中・議論を続けてください/)).toBeVisible();
  await page.waitForTimeout(2500);

  await page.getByRole("button", { name: "グループの議論を終える" }).click();
  await page.getByRole("button", { name: "終える", exact: true }).click();
  await expect(page.getByText(/録音の分析が終わりました/)).toBeVisible({ timeout: 30_000 });

  await page.getByLabel("グループの結論を、あなたはどう理解した？").fill("練習の中身を見直して時間を短くする");
  await page.getByRole("button", { name: "おおむね納得" }).click();
  await page.getByRole("button", { name: "提出する" }).click();
  // モックの分析結果（録音から書かれた results/flow-g1）が、結果の画面に出る
  await expect(page.getByText("デモデータです。本物の Gemini では、録音から話題の流れを読み取ります。")).toBeVisible({ timeout: 30_000 });
});

test("QR コードの URL では参加コードが入力済みになる", async ({ page }) => {
  await page.goto("/join?code=demo01");
  await expect(page.getByLabel("参加コード")).toHaveValue("DEMO01");
});

test("誤った参加コードではエラーが出る", async ({ page }) => {
  // 模擬Googleのエミュレータ認証は、外部の Google スクリプトなしで完了する。
  let externalAuthRequests = 0;
  await page.route("https://apis.google.com/**", route => {
    externalAuthRequests++;
    return route.abort();
  });
  await page.goto("/join");
  await page.getByLabel("参加コード").fill("ZZZZZZ");
  await page.getByRole("button", { name: "テスト用の生徒でログイン（エミュレータ）" }).click();
  await page.getByRole("button", { name: "参加する" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "参加コード" })).toContainText("参加コードが見つかりません");
  expect(externalAuthRequests, "エミュレータ認証が外部通信に依存していない").toBe(0);
});

test("スマホの幅でも、ログインと参加の画面が横にはみ出さない", async ({ page }) => {
  for (const path of ["/", "/join"]) {
    await page.goto(path);
    await expect(page.getByRole("link", { name: /参加コードを入力/ }).or(page.getByLabel("参加コード"))).toBeVisible();
    const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
    expect(scroll, `${path} の横幅`).toBeLessThanOrEqual(width);
  }
});
