import { enterCurrentSession } from "./current-session";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { loginStudent } from "./student";

// 司会者が部屋を作り、参加者がスマホで参加コードを入れて参加し、非公開の意見を出せるところまで
import { emulatorGoogleUser } from "../../firebase/emulator-auth.mjs";
async function moderatorToken(request: APIRequestContext): Promise<string> {
  const token = (await emulatorGoogleUser("teacher", `e2e-${Date.now()}`)).idToken;
  const login = await request.post("/api/sessions", { headers: { authorization: `Bearer ${token}` }, data: { deviceLabel: "架空の先生の端末", deviceType: "pc" } });
  expect(login.status()).toBe(201); // APIRequestContextのCookie jarに保存し、部屋作成も同じセッションを使う。
  return token;
}

test("/api は Cloud Run 役の API に転送される", async ({ request }) => {
  for (const path of ["/api/healthz", "/api/health"]) {
    const res = await request.get(path);
    expect(res.ok()).toBeTruthy();
    expect(await res.json()).toEqual({ ok: true, gemini: "mock" });
  }
});

test("参加コードで参加し、登録後に待機してHostの開始で議論へ進む", async ({ page, request }) => {
  const hostToken = await moderatorToken(request);
  const created = await request.post("/api/rooms", {
    headers: { authorization: `Bearer ${hostToken}` },
    data: { flowVersion: 1, title: "大学における生成AI利用の是非" },
  });
  expect(created.status()).toBe(201);
  const { joinCode, roomId } = await created.json();

  await loginStudent(page);
  await page.getByRole("button", { name: "参加する", exact: true }).click();
  await page.getByLabel("参加コード").fill(joinCode);
  await page.getByRole("dialog", { name: "議論に参加する" }).getByRole("button", { name: "参加する", exact: true }).click();

  await expect(page.getByRole("heading", { name: "大学における生成AI利用の是非" })).toBeVisible();
  await enterCurrentSession(page);

  await request.post(`/api/rooms/${roomId}/phase`, { headers: { authorization: `Bearer ${hostToken}` }, data: { to: "discussing" } });
  // グループ（この部屋は1グループ・1人）の全員の意見がそろったので、議論の画面に自動で変わる
  await expect(page.getByRole("main", { name: "話し合い中", exact: true })).toBeVisible();
});

test("ブラウザのマイク許可で録音し、議論を終えると録音が分析され、結果に議論の流れが出る", async ({ page, request }) => {
  const hostToken = await moderatorToken(request);
  const created = await request.post("/api/rooms", {
    headers: { authorization: `Bearer ${hostToken}` },
    data: { flowVersion: 1, title: "部活動の時間を短くするべきか", publishOnEnd: false },
  });
  const { joinCode, roomId } = await created.json();
  await loginStudent(page);
  await page.goto(`/join?code=${joinCode}`);
  await expect(page).toHaveURL(/\/rooms\//);
  await enterCurrentSession(page);

  await request.post(`/api/rooms/${roomId}/phase`, { headers: { authorization: `Bearer ${hostToken}` }, data: { to: "discussing" } });
  await expect(page.getByRole("main", { name: "話し合い中", exact: true })).toBeVisible();

  // アプリ内の許可選択はなく、開始操作からブラウザのマイク許可へ進む
  const start = page.getByRole("button", { name: "録音を始める" });
  await expect(start).toBeEnabled();
  await expect(page.getByText("グループ全員が、録音することに同意しました", { exact: true })).toHaveCount(0);

  await start.click();
  await expect(page.getByText("録音中", { exact: true })).toBeVisible();
  await page.waitForTimeout(2500);

  await request.post(`/api/rooms/${roomId}/finish`, { headers: { authorization: `Bearer ${hostToken}` }, data: {} });
  await expect(page.getByText("録音の送信・分析が完了しました。", { exact: true })).toBeVisible({ timeout: 30_000 });

  await page.getByLabel("グループの結論を、あなたはどう理解した？").fill("練習の中身を見直して時間を短くする");
  await page.getByRole("button", { name: "おおむね納得" }).click();
  await page.getByRole("button", { name: "提出する" }).click();
  await expect(page.getByText("結果は教員が公開すると表示されます。")).toBeVisible();
  await request.post(`/api/rooms/${roomId}/settings`, { headers: { authorization: `Bearer ${hostToken}` }, data: { resultsPublished: true } });
  // モックの分析結果（録音から書かれた results/flow-g1）が、結果の画面に出る
  await expect(page.getByText("デモデータです。本物の Gemini では、録音から話題の流れを読み取ります。")).toBeVisible({ timeout: 30_000 });
});

test("QR コードの URL から開くと、ログインのあとにそのまま参加する", async ({ page, request }) => {
  const hostToken = await moderatorToken(request);
  const created = await request.post("/api/rooms", { headers: { authorization: `Bearer ${hostToken}` }, data: { flowVersion: 1, title: "QRからの参加" } });
  const { joinCode, roomId } = await created.json();
  expect(joinCode).toMatch(/^\d{6}$/);
  await page.goto(`/join?code=${joinCode}`);
  await expect(page).toHaveURL(/\/$/);
  await loginStudent(page, "", { home: false });
  await expect(page).toHaveURL(new RegExp(`/rooms/${roomId}$`));
  await expect(page.getByLabel("参加コード")).toHaveCount(0);
  // 戻るで ?code= のホームに戻り、自動参加で部屋へ連れ戻されない
  await page.goBack();
  await page.waitForTimeout(1500);
  expect(new URL(page.url()).pathname).not.toBe(`/rooms/${roomId}`);
  expect(new URL(page.url()).searchParams.get("code")).toBeNull();
});

test("誤った参加コードではエラーが出る", async ({ page }) => {
  // 本番と同じポップアップ用SDKを使うが、本人確認を実Google/Firebaseの認証APIへ送らない。
  let externalAuthRequests = 0;
  await page.context().route(/^https:\/\/(accounts\.google\.com|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com)\//, route => {
    externalAuthRequests++;
    return route.abort();
  });
  await loginStudent(page);
  await page.getByRole("button", { name: "参加する", exact: true }).click();
  await page.getByLabel("参加コード").fill("999999");
  await page.getByRole("dialog", { name: "議論に参加する" }).getByRole("button", { name: "参加する", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "参加コード" })).toContainText("参加コードが見つかりません");
  expect(externalAuthRequests, "本人確認はローカルの認証エミュレータだけを使う").toBe(0);
});

test("スマホの幅でも、ログインと参加の画面が横にはみ出さない", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Googleで続行", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await loginStudent(page);
  for (const path of ["/student", "/join"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByLabel("参加コード")).toHaveCount(0);
    await page.getByRole("button", { name: "参加する", exact: true }).click();
    await expect(page.getByLabel("参加コード")).toBeVisible();
    const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
    expect(scroll, `${path} の横幅`).toBeLessThanOrEqual(width);
  }
});
