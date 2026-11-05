import { expect, test } from "@playwright/test";

// 司会者が部屋を作り、参加者がスマホで参加コードを入れて参加し、非公開の意見を出せるところまで
async function moderatorToken(): Promise<string> {
  const r = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `mod${Date.now()}@example.com`, password: "password", returnSecureToken: true }), // submit-allow: エミュレータ専用のダミー
  });
  return (await r.json()).idToken;
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
  await page.getByRole("button", { name: "参加する" }).click();

  await expect(page.getByRole("heading", { name: "大学における生成AI利用の是非" })).toBeVisible();
  await expect(page.getByTestId("phase")).toHaveText("事前意見の受付中");
  await page.getByLabel("あなたの意見").fill("AI を使ったことを申告するルールが必要");
  await page.getByRole("button", { name: "提出する" }).click();
  // グループ（この部屋は1グループ・1人）の全員の意見がそろったので、議論の画面に自動で変わる
  await expect(page.getByRole("heading", { name: "グループで話し合いましょう" })).toBeVisible();
});

test("QR コードの URL では参加コードが入力済みになる", async ({ page }) => {
  await page.goto("/join?code=demo01");
  await expect(page.getByLabel("参加コード")).toHaveValue("DEMO01");
});

test("誤った参加コードではエラーが出る", async ({ page }) => {
  // 匿名のエミュレータ認証は、外部の Google スクリプトなしで完了する。
  let externalAuthRequests = 0;
  await page.route("https://apis.google.com/**", route => {
    externalAuthRequests++;
    return route.abort();
  });
  await page.goto("/join");
  await page.getByLabel("参加コード").fill("ZZZZZZ");
  await page.getByRole("button", { name: "参加する" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "参加コード" })).toContainText("参加コードが見つかりません");
  expect(externalAuthRequests, "エミュレータ認証が外部通信に依存していない").toBe(0);
});
