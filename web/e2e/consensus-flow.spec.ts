import { enrollCurrentVoice } from "./current-session";
import { loginGoogle } from "./google";
import { expect, test, type Page } from "@playwright/test";
import { loginStudent } from "./student";

// 1本化した流れ（参加準備 → 議論と未検討論点の提案・承認 → 終了 → 結論の一文 → 結果）を、教員の作成画面から通す。
// 手順書10-3のデモの流れと、Docs の MVPフロー（Host開始・強制終了・結果）の両方を含む。

async function joinAndWait(guest: Page, code: string, name: string) {
  await guest.goto(`/join?code=${code}`);
  await expect(guest).toHaveURL(/\/rooms\//);
  await guest.getByLabel("参加者1の表示名").fill(name);
  await guest.getByRole("button", { name: "表示名を保存して進む" }).click();
  await enrollCurrentVoice(guest);
  await expect(guest.getByRole("heading", { name: "参加できました", exact: true })).toBeVisible();
}

test("事前意見なしで待機・議論・終了・結論の一文のずれを通す", async ({ page, browser }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto("/");
  await loginGoogle(page, "teacher");
  await page.waitForURL(/\/home$/); await page.goto("/host/new");
  await page.getByLabel("テーマ", { exact: true }).fill("架空の授業でAIを使うときのルール");
  await page.getByLabel("セッション名", { exact: true }).fill("架空の2年3組");
  await page.screenshot({ path: "../docs/screenshots/unified-host-new-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "セッションを作成", exact: true }).click();
  await expect(page).toHaveURL(/\/rooms\//);
  const code = (await page.getByTestId("join-code").textContent())!.replace(/\s/g, "");

  const origin = new URL(page.url()).origin;
  const contexts = await Promise.all([1, 2].map(() => browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 } })));
  try {
    const [a, b] = await Promise.all(contexts.map((c) => c.newPage()));
    for (const g of [a, b]) g.on("pageerror", (e) => pageErrors.push(e.message));
    await loginStudent(a, "a"); await loginStudent(b, "b");
    await joinAndWait(a, code, "架空の学生A");
    await joinAndWait(b, code, "架空の学生B");
    await expect(page.getByRole("region", { name: "集まり具合" })).toContainText(/参加\s*2人/);

    // 教員が開始すると、全員が議論の画面に変わる（時間は設定しない）
    await page.getByRole("button", { name: "議論を開始", exact: true }).click();
    for (const g of [a, b]) await expect(g.getByRole("main", { name: "話し合い中", exact: true })).toBeVisible();
    await expect(a.getByRole("timer", { name: "経過時間" })).toBeVisible();
    for (const g of [a,b]) await g.getByRole("button", { name: "設定を開く", exact: true }).click();
    for (const g of [a,b]) await g.locator("summary").filter({ hasText: "発言メモ" }).click();

    // 議論の発言をメモで共有する
    await a.getByLabel("発言を書く").fill("貸出の費用の話をした");
    await a.getByRole("button", { name: "メモを共有する", exact: true }).click();
    await expect(b.getByRole("region", { name: "議論の発言メモ" })).toContainText("貸出の費用の話をした");

    await page.getByRole("button", { name: "グループ1の詳細を開く", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "グループ1", exact: true })).toBeVisible();

    // 事前意見を送っていないため、モックの比較元となる論点もない。
    await page.getByRole("button", { name: "未検討の論点を探す", exact: true }).click();
    await expect(page.getByRole("heading", { name: "いまは新しい提案はありません" })).toBeVisible();
    await expect(page.getByRole("button", { name: "全員に表示する", exact: true })).toHaveCount(0);
    await a.screenshot({ path: "../docs/screenshots/unified-guest-discussion-mobile.png", fullPage: true });

    await page.getByRole("button", { name: "グループ詳細を閉じる", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "グループ1", exact: true })).not.toBeVisible();

    // 教員が終了すると、全員が結論の一文を書く
    await page.getByRole("button", { name: "議論を終える", exact: true }).click();
    await page.getByRole("button", { name: "終えて結果を見る", exact: true }).click();
    await expect(page.getByRole("heading", { name: "録音の振り返り", exact: true })).toBeVisible({ timeout: 20_000 });
    const statements = ["申告すればAIを使ってよい", "教員の許可がある場合だけAIを使ってよい"];
    for (const [i, g] of [a, b].entries()) {
      await expect(g.getByRole("heading", { name: "結論を自分の言葉で書く" })).toBeVisible({ timeout: 20_000 });
      await g.getByLabel("グループの結論を、あなたはどう理解した？").fill(statements[i]);
      await g.getByRole("button", { name: "おおむね納得", exact: true }).click();
      await g.getByRole("button", { name: "提出する", exact: true }).click();
    }

    // 全員がそろうとグループの結果が出る。教員が結果をまとめると、理解のずれと指標が出る
    await expect(page.getByText("グループ1：結果あり")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "結果をまとめる", exact: true }).click();
    await expect(page.getByRole("button", { name: "結果をまとめ直す", exact: true })).toBeVisible();
    await expect(page.getByText("理解が2通り")).toBeVisible();
    for (const o of statements) await expect(page.locator("main")).not.toContainText(o);
    await expect(a.getByText("同じ結論を、どう理解した？")).toBeVisible();
    await page.screenshot({ path: "../docs/screenshots/unified-host-result-mobile.png", fullPage: true });
    expect(pageErrors).toEqual([]);
  } finally { await Promise.all(contexts.map((c) => c.close())); }
});
