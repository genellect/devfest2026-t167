import { loginGoogle } from "./google";
import { expect, test, type Page } from "@playwright/test";
import { loginStudent } from "./student";

// 1本化した流れ（事前意見 → 議論と未検討論点の提案・承認 → 終了 → 結論の一文 → 結果）を、教員の作成画面から通す。
// 手順書10-3のデモの流れと、Docs の MVPフロー（Host開始・強制終了・結果）の両方を含む。

async function joinAndWriteOpinion(guest: Page, code: string, name: string, opinion: string) {
  await guest.goto(`/join?code=${code}`);
  await expect(guest).toHaveURL(/\/rooms\//);
  await guest.getByLabel("参加者1の表示名").fill(name);
  await guest.getByRole("button", { name: "表示名を保存して進む" }).click();
  // 音声登録は任意。あとで登録を選んでも、そのまま進める
  await guest.getByRole("button", { name: "あとで登録する", exact: true }).click();
  await guest.getByLabel("あなたの意見（本人だけが見られます）").fill(opinion);
  await guest.getByRole("button", { name: "提出する", exact: true }).click();
  await expect(guest.getByText("提出しました")).toBeVisible();
}

test("事前意見・未検討論点の承認・終了・結論の一文のずれを、1本の流れで通す", async ({ page, browser }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto("/");
  await loginGoogle(page, "teacher");
  await page.waitForURL(/\/teacher$/); await page.goto("/host/new");
  await page.getByLabel("テーマ", { exact: true }).fill("架空の授業でAIを使うときのルール");
  await page.getByLabel("クラス名（任意）").fill("架空の2年3組");
  await page.screenshot({ path: "../docs/screenshots/unified-host-new-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "作成する", exact: true }).click();
  await expect(page).toHaveURL(/\/rooms\//);
  const code = (await page.getByTestId("join-code").textContent())!.replace(/\s/g, "");

  const origin = new URL(page.url()).origin;
  const contexts = await Promise.all([1, 2].map(() => browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 } })));
  try {
    const [a, b] = await Promise.all(contexts.map((c) => c.newPage()));
    for (const g of [a, b]) g.on("pageerror", (e) => pageErrors.push(e.message));
    await loginStudent(a, "a"); await loginStudent(b, "b");
    const opinions = ["架空の授業では、AIを使った箇所を申告する決まりを作り、透明性を確保するべきだと考える。", "架空の授業では、端末を持たない学生に貸出をして、費用で参加の機会が変わらないようにしたい。"];
    await joinAndWriteOpinion(a, code, "架空の学生A", opinions[0]);
    await joinAndWriteOpinion(b, code, "架空の学生B", opinions[1]);
    await expect(page.getByRole("region", { name: "集まり具合" })).toContainText(/事前意見\s*2\/2人/);

    // 教員が開始すると、全員が議論の画面に変わる（時間は設定しない）
    await page.getByRole("button", { name: "議論を開始", exact: true }).click();
    for (const g of [a, b]) await expect(g.getByRole("heading", { name: "グループで話し合いましょう" })).toBeVisible();
    await expect(a.getByRole("timer")).toHaveCount(0);

    // 議論の発言をメモで共有する
    await a.getByLabel("発言を書く").fill("貸出の費用の話をした");
    await a.getByRole("button", { name: "メモを共有する", exact: true }).click();
    await expect(b.getByRole("region", { name: "議論の発言メモ" })).toContainText("貸出の費用の話をした");

    // 教員には提案だけが出て、事前意見の本文は出ない。承認すると全員に届く
    await page.getByRole("button", { name: "未検討の論点を探す", exact: true }).click();
    const proposal = page.locator(".box--yellow").filter({ hasText: "まだ議論されていない論点" }).first();
    await expect(proposal).toBeVisible();
    for (const o of opinions) await expect(page.locator("main")).not.toContainText(o);
    const summary = (await proposal.locator(".t-md").innerText()).trim();
    await expect(a.getByRole("region", { name: "教員からの問いかけ" })).not.toContainText(summary);
    await proposal.getByRole("button", { name: "全員に表示する", exact: true }).click();
    for (const g of [a, b]) await expect(g.getByRole("region", { name: "教員からの問いかけ" })).toContainText(summary);

    // 残った提案は「見送る」で消え、学生には届かない。上の数字も減る
    const rest = page.locator(".box--yellow").filter({ hasText: "まだ議論されていない論点" });
    await expect(rest).toHaveCount(1);
    const dismissed = (await rest.locator(".t-md").innerText()).trim();
    await expect(page.getByRole("region", { name: "議論の進み具合" })).toContainText(/未検討の論点\s*1/);
    await rest.getByRole("button", { name: "見送る", exact: true }).click();
    await expect(rest).toHaveCount(0);
    await expect(page.getByRole("region", { name: "議論の進み具合" })).toContainText(/未検討の論点\s*0/);
    await expect(page.getByRole("heading", { name: "いまは新しい提案はありません" })).toBeVisible();
    for (const g of [a, b]) await expect(g.getByRole("region", { name: "教員からの問いかけ" })).not.toContainText(dismissed);
    await a.screenshot({ path: "../docs/screenshots/unified-guest-discussion-mobile.png", fullPage: true });

    // 教員が終了すると、全員が結論の一文を書く
    await page.getByRole("button", { name: "議論を終える", exact: true }).click();
    await page.getByRole("button", { name: "終えて結果を見る", exact: true }).click();
    const statements = ["申告すればAIを使ってよい", "教員の許可がある場合だけAIを使ってよい"];
    for (const [i, g] of [a, b].entries()) {
      await expect(g.getByRole("heading", { name: "結論を自分の言葉で書く" })).toBeVisible();
      await g.getByLabel("グループの結論を、あなたはどう理解した？").fill(statements[i]);
      await g.getByRole("button", { name: "おおむね納得", exact: true }).click();
      await g.getByRole("button", { name: "提出する", exact: true }).click();
    }

    // 全員がそろうとグループの結果が出る。教員が結果をまとめると、理解のずれと指標が出る
    await expect(page.getByText("グループ1：結果あり")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "結果をまとめる", exact: true }).click();
    await expect(page.getByRole("button", { name: "結果をまとめ直す", exact: true })).toBeVisible();
    await expect(page.getByText("理解が2通り")).toBeVisible();
    for (const o of [...opinions, ...statements]) await expect(page.locator("main")).not.toContainText(o);
    await expect(a.getByText("同じ結論を、どう理解した？")).toBeVisible();
    await page.screenshot({ path: "../docs/screenshots/unified-host-result-mobile.png", fullPage: true });
    expect(pageErrors).toEqual([]);
  } finally { await Promise.all(contexts.map((c) => c.close())); }
});
