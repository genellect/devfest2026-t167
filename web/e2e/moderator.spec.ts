import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

async function createRoom(page: Page, title: string) {
  await page.goto("/");
  await page.getByLabel("議論のテーマ").fill(title);
  const opened = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Googleでログインして部屋を作る" }).click();
  const popup = await opened;
  await popup.waitForLoadState("load");
  await popup.getByText("Add new account", { exact: true }).click();
  await expect(popup.getByLabel("Email", { exact: true })).toBeVisible();
  await popup.getByLabel("Email", { exact: true }).fill(`infra-${randomUUID()}@example.com`);
  await popup.getByRole("button", { name: "Sign in with Google.com", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  return (await page.getByTestId("join-code").innerText()).trim();
}

test("司会者のGoogle認証から部屋を作り、匿名参加者の意見を分析して提案が表示される", async ({ page, browser }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  const title = "架空の授業でAIを使うときのルール";
  const code = await createRoom(page, title);
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
  const participantContext = await browser.newContext({ baseURL: new URL(page.url()).origin, viewport: { width: 390, height: 844 } });
  try {
    const participant = await participantContext.newPage();
    participant.on("pageerror", error => pageErrors.push(error.message));
    await participant.goto("/");
    await participant.getByLabel("参加コード").fill(code);
    await participant.getByRole("button", { name: "参加する", exact: true }).click();
    await expect(participant.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(participant.getByRole("region", { name: "司会者の操作" })).toHaveCount(0);
    const opinion = "架空の授業では、端末を持たない学生のために貸出制度を用意し、費用によって参加の機会が変わらないようにする必要がある。AIを利用した箇所を申告する方法も、授業の開始前に全員で決めておきたい。";
    await participant.getByLabel("あなたの意見").fill(opinion);
    await participant.getByRole("button", { name: "提出する", exact: true }).click();
    await expect(participant.getByRole("status")).toHaveText("提出しました");
    await expect(page.locator("main")).not.toContainText(opinion);
    await page.getByRole("button", { name: "議論を開始する", exact: true }).click();
    await expect(participant.getByTestId("phase")).toHaveText("議論中");
    await page.getByRole("button", { name: "未検討の論点を分析する", exact: true }).click();
    const proposals = page.getByRole("region", { name: "司会者への提案" });
    await expect(proposals.getByRole("listitem")).toHaveCount(1);
    await expect(proposals).toContainText("デモデータ");
    await expect(page.locator("main")).not.toContainText(opinion);
    await expect(participant.getByRole("region", { name: "司会者への提案" })).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally { await participantContext.close(); }
});

test("分析が503になっても議論画面に残り、失敗を表示して再試行できる", async ({ page }) => {
  await createRoom(page, "架空の障害確認");
  await page.getByRole("button", { name: "議論を開始する", exact: true }).click();
  await expect(page.getByTestId("phase")).toHaveText("議論中");
  await page.route("**/api/rooms/*/analyze", route => route.fulfill({
    status: 503, contentType: "application/json",
    body: JSON.stringify({ error: { code: "gemini_unavailable", message: "AIの提案は一時停止中です。議論はそのまま続けられます" } }),
  }));
  await page.getByRole("button", { name: "未検討の論点を分析する", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("AIの提案は一時停止中です");
  await expect(page.getByTestId("phase")).toHaveText("議論中");
  await expect(page.getByRole("button", { name: "未検討の論点を分析する", exact: true })).toBeEnabled();
});

test("実行中のまま残った分析も60秒後に再読み込みなしで再試行できる", async ({ page, request }) => {
  await createRoom(page, "架空の分析ロック確認");
  await page.getByRole("button", { name: "議論を開始する", exact: true }).click();
  await expect(page.getByTestId("phase")).toHaveText("議論中");
  const roomId = new URL(page.url()).pathname.split("/").pop();
  const url = `http://127.0.0.1:8080/v1/projects/demo-t167/databases/(default)/documents/rooms/${roomId}?updateMask.fieldPaths=analysis`;
  async function runningSince(timestamp: number) {
    const res = await request.patch(url, {
      headers: { authorization: "Bearer owner" }, // submit-allow: Firestoreエミュレータ専用の管理者ダミー
      data: { fields: { analysis: { mapValue: { fields: { status: { stringValue: "running" }, startedAt: { timestampValue: new Date(timestamp).toISOString() } } } } } },
    });
    expect(res.ok()).toBeTruthy();
  }
  await page.clock.install();
  await runningSince(Date.now());
  await expect(page.getByRole("button", { name: "分析中…", exact: true })).toBeDisabled();
  await page.clock.fastForward(61_000);
  await expect(page.getByRole("button", { name: "未検討の論点を分析する", exact: true })).toBeEnabled();
  // API の時計も期限切れの状態に合わせ、再試行が実際に成功することを確かめる。
  await runningSince(Date.now() - 61_000);
  await page.getByRole("button", { name: "未検討の論点を分析する", exact: true }).click();
  await expect(page.getByText("新しい提案はありません。", { exact: true })).toBeVisible();
});
