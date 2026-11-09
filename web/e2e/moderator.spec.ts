import { expect, test } from "@playwright/test";
import { loginStudent } from "./student";

test("共通ホームから作成し、開始・強制終了・結果・共通ホームへ進む", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "テスト用の先生でログイン（エミュレータ）", includeHidden: true }).evaluate(element => (element as HTMLButtonElement).click());
  await expect(page).toHaveURL(/\/home$/);
  await page.getByRole("button", { name: "ホストする", exact: true }).click();
  await page.getByLabel("テーマ", { exact: true }).fill("チームで何を作るか");
  await page.getByRole("button", { name: "作成する", exact: true }).click();
  await expect(page).toHaveURL(/\/rooms\//);
  await page.getByRole("button", { name: "議論を開始", exact: true }).click();
  // 時間は設定しない。教員が終えるまで議論が続く
  await expect(page.getByRole("button", { name: "議論を終える", exact: true })).toBeVisible();
  // 教員には経過時間だけを出す（残り時間のカウントダウンは出さない）
  await expect(page.getByRole("timer", { name: "経過時間" })).toBeVisible();
  await expect(page.getByRole("timer", { name: "残り時間" })).toHaveCount(0);
  await page.getByRole("button", { name: "議論を終える", exact: true }).click();
  await page.getByRole("button", { name: "終了する", exact: true }).click();
  // 参加者がいない議論は、結果がないことだけを出す（空の指標や録音の欄は出さない）
  await expect(page.getByRole("heading", { name: "この議論には参加者がいませんでした", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "録音の振り返り", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "ホームに戻る", exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("region", { name: "最近の議論" }).getByRole("link", { name: /チームで何を作るか/ }).first()).toContainText("終了");
});

test("議論が始まったあとも、参加コードで途中から参加して、そのまま話し合いに加われる", async ({ page, browser }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "テスト用の先生でログイン（エミュレータ）", includeHidden: true }).evaluate(element => (element as HTMLButtonElement).click());
  await page.getByRole("button", { name: "ホストする", exact: true }).click();
  await page.getByLabel("テーマ", { exact: true }).fill("途中参加の確認");
  await page.getByRole("button", { name: "作成する", exact: true }).click();
  await expect(page).toHaveURL(/\/rooms\//);
  const code = (await page.getByTestId("join-code").innerText()).replace(/\D/g, "");
  await page.getByRole("button", { name: "議論を開始", exact: true }).click();
  // 議論中も、教員の画面に参加コードを出す
  const invite = page.getByRole("region", { name: "参加コード", exact: true });
  await expect(invite.getByTestId("join-code")).toContainText(code.slice(0, 3));
  await expect(invite.getByRole("img", { name: /参加用のQRコード/ })).toBeVisible();

  const student = await (await browser.newContext({ baseURL: new URL(page.url()).origin })).newPage();
  await loginStudent(student, "late");
  await student.goto("/join");
  await student.getByLabel("参加コード").fill(code);
  await student.getByRole("button", { name: "参加する", exact: true }).click();
  await expect(student.getByText("議論はもう始まっています。")).toBeVisible();
  await student.getByLabel("参加者1の表示名", { exact: true }).fill("途中の人");
  await student.getByRole("button", { name: "表示名を保存して進む", exact: true }).click();
  // 声の登録は出さずに、議論の画面へ進む
  await expect(student.getByRole("heading", { name: "グループで話し合いましょう" })).toBeVisible();
  await expect(student.getByRole("heading", { name: "声の登録", exact: true })).toHaveCount(0);
  await student.context().close();
});

test("作成画面は引き継いだテーマとセッション名を別々に保存する", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "テスト用の先生でログイン（エミュレータ）", includeHidden: true }).evaluate(element => (element as HTMLButtonElement).click());
  await expect(page).toHaveURL(/\/home$/);
  const theme = "SNSの情報をどのように見分けるか";
  await page.goto(`/host/new?theme=${encodeURIComponent(theme)}`);
  await expect(page.getByLabel("セッション名", { exact: true })).toHaveValue("無題のセッション");
  await expect(page.getByLabel("テーマ", { exact: true })).toHaveValue(theme);
  await page.getByLabel("セッション名", { exact: true }).fill("情報の授業");
  const created = page.waitForResponse(response => response.url().endsWith("/api/rooms") && response.request().method() === "POST");
  await page.getByRole("button", { name: "作成する", exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON()).toMatchObject({ title: "情報の授業", theme });
  await expect(page).toHaveURL(/\/rooms\//);
});

/** Firestore エミュレータに、録音の分析が書いたのと同じ形のデータを置く（API の保存と認可は api の結合テストで確かめる）。mask があればその欄だけを書き換える */
async function putDoc(path: string, fields: Record<string, unknown>, mask?: string) {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  const project = process.env.GOOGLE_CLOUD_PROJECT ?? "demo-t167";
  const value = (v: unknown): unknown => typeof v === "string" ? { stringValue: v }
    : typeof v === "boolean" ? { booleanValue: v }
    : typeof v === "number" ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
    : Array.isArray(v) ? { arrayValue: { values: v.map(value) } }
    : { mapValue: { fields: Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, value(x)])) } };
  const res = await fetch(`http://${host}/v1/projects/${project}/databases/(default)/documents/${path}${mask ? `?updateMask.fieldPaths=${encodeURIComponent(mask)}` : ""}`, {
    method: "PATCH", headers: { authorization: "Bearer owner", "content-type": "application/json" },
    body: JSON.stringify({ fields: (value(fields) as { mapValue: { fields: object } }).mapValue.fields }),
  });
  expect(res.ok).toBe(true);
}

test("録音と事前の意見を照らし合わせた論点のうち、話されなかったものを終了後の先生の画面に出す", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "テスト用の先生でログイン（エミュレータ）", includeHidden: true }).evaluate(element => (element as HTMLButtonElement).click());
  await expect(page).toHaveURL(/\/home$/);
  await page.getByRole("button", { name: "ホストする", exact: true }).click();
  await page.getByLabel("テーマ", { exact: true }).fill("大学の課題提出で AI の利用を認めるべきか");
  await page.getByRole("button", { name: "作成する", exact: true }).click();
  await expect(page).toHaveURL(/\/rooms\//);
  const roomId = new URL(page.url()).pathname.split("/")[2];
  await page.getByRole("button", { name: "議論を開始", exact: true }).click();
  await page.getByRole("button", { name: "議論を終える", exact: true }).click();
  await page.getByRole("button", { name: "終了する", exact: true }).click();
  await expect(page.getByText("この議論には参加者がいませんでした")).toBeVisible();

  // 録音を送ったグループがあるときだけ「録音の振り返り」が出る
  await putDoc(`sessions/${roomId}`, { groupState: { "1": { recording: { status: "done" } } } }, "groupState.`1`.recording");
  await putDoc(`sessions/${roomId}/results/flow-g1`, {
    group: 1, speechDetected: true, totalMinutes: 20, source: "mock", flowNote: "テーマから脱線した場面で、別の見方が出ました。",
    segments: [{ topic: "意見の出し合い", minutes: 6 }, { topic: "理由の深掘り", minutes: 7 }, { topic: "テーマから脱線", minutes: 3, highlight: true }, { topic: "まとめ", minutes: 4 }],
    good: [{ at: "6:00", text: "別の見方を出して、話題を広げました。" }], review: [{ at: "12:00", text: "事前の意見を話す機会がありました。" }],
    teacherSuggestions: [],
  });
  await putDoc(`sessions/${roomId}/results/points-g1`, {
    group: 1, opinions: 3, source: "mock",
    points: [
      { summary: "利用したことを申告するかどうか", discussed: true, at: "4:10" },
      { summary: "アイデア出しに限って使う", discussed: true, at: "9:30" },
      { summary: "教員の許可を条件にする", discussed: false },
    ],
  });
  await expect(page.getByRole("heading", { name: "録音の振り返り", exact: true })).toBeVisible({ timeout: 20_000 });
  const review = page.locator(".review-group").filter({ hasText: "グループ1" });
  await expect(review.getByText("事前の意見の論点 3件のうち、議論で話されたのは 2件（録音から判定）")).toBeVisible({ timeout: 20_000 });
  const missed = review.getByRole("list", { name: "話されなかった論点" });
  await expect(missed.getByRole("listitem")).toHaveCount(1);
  await expect(missed).toContainText("教員の許可を条件にする");
  await review.screenshot({ path: "../docs/screenshots/recording-points-teacher-mobile.png" });
});
