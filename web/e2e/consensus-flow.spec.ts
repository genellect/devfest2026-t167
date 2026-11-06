import { expect, test, type Page } from "@playwright/test";
import { loginStudent } from "./student";

// 手順書10-3のデモの流れ（事前意見 → 未検討論点の提案と承認 → 合意の一文のずれ）を、Hostの作成画面から通す。

async function joinAndWriteOpinion(guest: Page, code: string, opinion: string) {
  await guest.goto(`/join?code=${code}`);
  await expect(guest).toHaveURL(/\/rooms\//);
  await guest.getByLabel("あなたの意見（本人だけが見られます）").fill(opinion);
  await guest.getByRole("button", { name: "提出する", exact: true }).click();
  await expect(guest.getByText("グループのみんなの意見を待っています")).toBeVisible();
}

test("事前意見・未検討論点の承認・合意の一文のずれを、Hostの作成画面から通しで確かめる", async ({ page, browser }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "テスト用の先生でログイン（エミュレータ）" }).click();
  await page.waitForURL(/\/home$/); await page.goto("/host/new");
  await page.getByRole("button", { name: "事前意見と合意を確かめる", exact: true }).click();
  await page.getByLabel("テーマ", { exact: true }).fill("架空の授業でAIを使うときのルール");
  await page.getByRole("button", { name: "1", exact: true }).click();
  await page.getByRole("button", { name: "録音しない", exact: true }).click();
  await page.screenshot({ path: "../docs/screenshots/consensus-host-new-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "部屋を作る", exact: true }).click();
  await expect(page).toHaveURL(/\/rooms\//);
  await page.getByRole("button", { name: "参加コードを表示", exact: true }).click();
  const code = (await page.getByTestId("join-code").textContent())!.trim();
  await page.getByRole("button", { name: "ダッシュボードを見る" }).click();

  const origin = new URL(page.url()).origin;
  const contexts = await Promise.all([1, 2].map(() => browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 } })));
  try {
    const [a, b] = await Promise.all(contexts.map((c) => c.newPage()));
    for (const g of [a, b]) g.on("pageerror", (e) => pageErrors.push(e.message));
    await loginStudent(a, "a"); await loginStudent(b, "b");
    const opinions = ["架空の授業では、AIを使った箇所を申告する決まりを作り、透明性を確保するべきだと考える。", "架空の授業では、端末を持たない学生に貸出をして、費用で参加の機会が変わらないようにしたい。"];
    await joinAndWriteOpinion(a, code, opinions[0]);
    await joinAndWriteOpinion(b, code, opinions[1]);

    // Hostが議論を始めると、グループの議論の画面に変わる
    await page.getByText("セッション設定・グループ管理", { exact: true }).click();
    await page.getByRole("button", { name: "セッションを開始", exact: true }).click();
    for (const g of [a, b]) await expect(g.getByRole("heading", { name: "グループで話し合いましょう" })).toBeVisible();

    // 議論の発言をメモで共有する
    await a.getByLabel("発言を書く").fill("貸出の費用の話をした");
    await a.getByRole("button", { name: "メモを共有する", exact: true }).click();
    await expect(b.getByRole("region", { name: "議論の発言メモ" })).toContainText("貸出の費用の話をした");

    // Hostには提案だけが出て、事前意見の本文は出ない
    await page.getByRole("button", { name: "未検討の論点を探す", exact: true }).click();
    const proposal = page.locator(".box--yellow").filter({ hasText: "まだ議論されていない論点" }).first();
    await expect(proposal).toBeVisible();
    for (const o of opinions) await expect(page.locator("main")).not.toContainText(o);
    const summary = (await proposal.locator(".t-md").innerText()).trim();
    await expect(a.locator("main")).not.toContainText(summary);
    await proposal.getByRole("button", { name: "全員に表示する", exact: true }).click();
    for (const g of [a, b]) await expect(g.locator("main")).toContainText(summary);
    await a.screenshot({ path: "../docs/screenshots/consensus-guest-discussion-mobile.png", fullPage: true });

    // グループの議論を終え、全員が結論の一文を書くと、理解のずれが結果に出る
    await a.getByRole("button", { name: "グループの議論を終える", exact: true }).click();
    await a.getByRole("button", { name: "終える", exact: true }).click();
    const statements = ["申告すればAIを使ってよい", "教員の許可がある場合だけAIを使ってよい"];
    for (const [i, g] of [a, b].entries()) {
      await expect(g.getByRole("heading", { name: "結論を自分の言葉で書く" })).toBeVisible();
      await g.getByLabel("グループの結論を、あなたはどう理解した？").fill(statements[i]);
      await g.getByRole("button", { name: "おおむね納得", exact: true }).click();
      await g.getByRole("button", { name: "提出する", exact: true }).click();
    }
    await expect(page.getByText("結果が出たグループ 1/1")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "詳しく見る", exact: true }).click();
    await expect(page.getByText("同じ結論の理解が、2通りに分かれました。")).toBeVisible();
    for (const o of opinions) await expect(page.locator("main")).not.toContainText(o);
    expect(pageErrors).toEqual([]);
  } finally { await Promise.all(contexts.map((c) => c.close())); }
});
