import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

// 先生の導線（#20 から移した確認）。Google でログイン（認証のエミュレータ）→ 部屋を作る → 生徒が参加して意見を出す
// → 先生が未検討の論点を探す。分析の失敗（503）と、途中で止まった分析の期限切れのあとも、やり直せること。

/** テスト用の先生（firebase/seed.mjs と同じアカウント）をエミュレータに用意する。すでにあれば何もしない */
async function ensureTestTeacher() {
  await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099"}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "mod@example.com", password: "password", returnSecureToken: true }), // submit-allow: エミュレータ専用のダミー
  });
}

/** はじめてのログインのあと、役割に先生を選んでプロフィールを登録する */
async function registerAsTeacher(page: Page) {
  await page.waitForURL(/\/signup$/);
  await page.getByRole("button", { name: /^先生/ }).click();
  await page.getByLabel("表示する名前").fill("架空の先生");
  await page.getByRole("button", { name: "登録してはじめる" }).click();
  await page.waitForURL(/\/host$/);
}

/** 先生のホームから、グループ1つの部屋を作り、参加コードを返す */
async function createRoom(page: Page, title: string) {
  await page.getByRole("navigation", { name: "メニュー" }).getByRole("link", { name: "部屋を作る" }).click();
  await page.getByLabel("テーマ").fill(title);
  await page.getByRole("button", { name: "1", exact: true }).click();
  await page.getByRole("button", { name: "部屋を作る" }).click();
  await page.waitForURL(/\/rooms\//);
  return (await page.getByTestId("join-code").innerText()).trim();
}

/** テスト用の先生でログインして部屋を作り、ダッシュボードを開く */
async function teacherDashboard(page: Page, title: string) {
  await ensureTestTeacher();
  await page.goto("/");
  await page.getByRole("button", { name: "テスト用の先生でログイン（エミュレータ）" }).click();
  await registerAsTeacher(page);
  await createRoom(page, title);
  await page.getByRole("button", { name: "ダッシュボードを見る" }).click();
}

test("先生が Google でログインして部屋を作り、生徒の意見から未検討の論点を探して全員に表示する", async ({ page, browser }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  const title = "架空の授業でAIを使うときのルール";
  await page.goto("/");
  const opened = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Googleでログイン" }).click();
  const popup = await opened;
  await popup.waitForLoadState("load");
  await popup.getByText("Add new account", { exact: true }).click();
  await popup.getByLabel("Email", { exact: true }).fill(`teacher-${randomUUID()}@example.com`);
  await popup.getByRole("button", { name: "Sign in with Google.com", exact: true }).click();
  await registerAsTeacher(page);
  const code = await createRoom(page, title);
  expect(code).toMatch(/^[A-Z0-9]{6}$/);

  const student = await browser.newContext({ baseURL: new URL(page.url()).origin, viewport: { width: 390, height: 844 } });
  try {
    const s = await student.newPage();
    s.on("pageerror", (e) => pageErrors.push(e.message));
    await s.goto(`/join?code=${code}`);
    await s.getByRole("button", { name: "参加する" }).click();
    const opinion = "架空の授業では、端末を持たない学生のために貸出制度を用意し、費用によって参加の機会が変わらないようにする必要がある。AIを利用した箇所を申告する方法も、授業の開始前に全員で決めておきたい。";
    await s.getByLabel("あなたの意見").fill(opinion);
    await s.getByRole("button", { name: "提出する" }).click();
    await expect(s.getByRole("heading", { name: "グループで話し合いましょう" })).toBeVisible();

    // 先生の画面には、生徒の意見の本文が出ない
    await page.getByRole("button", { name: "ダッシュボードを見る" }).click();
    await expect(page.locator("main")).not.toContainText(opinion);
    await page.getByRole("button", { name: "未検討の論点を探す" }).click();
    const proposal = page.locator(".box--yellow").filter({ hasText: "まだ議論されていない論点" });
    await expect(proposal).toHaveCount(1);
    await expect(proposal).toContainText("デモデータ");
    await expect(page.locator("main")).not.toContainText(opinion);
    const summary = (await proposal.locator(".t-md").innerText()).trim();

    // 承認するまでは、生徒の画面に出ない
    await expect(s.getByText("まだ話されていない論点が見つかると、先生がここに出します。")).toBeVisible();
    await expect(s.locator("main")).not.toContainText(summary);
    await proposal.getByRole("button", { name: "全員に表示する" }).click();
    await expect(s.locator("main")).toContainText(summary);
    expect(pageErrors).toEqual([]);
  } finally { await student.close(); }
});

test("分析が 503 になっても、一時停止を表示して、もう一度探せる", async ({ page }) => {
  await teacherDashboard(page, "架空の障害確認");
  await page.route("**/api/rooms/*/analyze", (route) => route.fulfill({
    status: 503, contentType: "application/json",
    body: JSON.stringify({ error: { code: "gemini_unavailable", message: "AI の提案は一時停止中です。議論はそのまま続けられます" } }),
  }));
  await page.getByRole("button", { name: "未検討の論点を探す" }).click();
  await expect(page.getByText("AIの分析は一時停止中です。議論はそのまま続けられます。")).toBeVisible();
  await expect(page.getByRole("button", { name: "未検討の論点を探す" })).toBeEnabled();
});

test("途中で止まった分析が残っても、60秒たつと再読み込みせずにもう一度探せる", async ({ page, request }) => {
  await teacherDashboard(page, "架空の分析ロック確認");
  const roomId = new URL(page.url()).pathname.split("/").pop();
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080"}/v1/projects/${process.env.GOOGLE_CLOUD_PROJECT ?? "demo-t167"}/databases/(default)/documents/rooms/${roomId}?updateMask.fieldPaths=analysis`;
  async function runningSince(timestamp: number) {
    const res = await request.patch(url, {
      headers: { authorization: "Bearer owner" }, // submit-allow: Firestore エミュレータ専用の管理者のダミー
      data: { fields: { analysis: { mapValue: { fields: { status: { stringValue: "running" }, startedAt: { timestampValue: new Date(timestamp).toISOString() } } } } } },
    });
    expect(res.ok()).toBeTruthy();
  }
  await page.clock.install();
  await runningSince(Date.now());
  await expect(page.getByRole("button", { name: "分析中…" })).toBeDisabled();
  await page.clock.fastForward(61_000);
  await expect(page.getByRole("button", { name: "未検討の論点を探す" })).toBeEnabled();
  // API の時計でも期限切れにして、やり直しが実際に通ることを確かめる
  await runningSince(Date.now() - 61_000);
  await page.getByRole("button", { name: "未検討の論点を探す" }).click();
  await expect(page.getByText("事前意見の論点は、すべて議論に出ています。")).toBeVisible();
});
