import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { emulatorGoogleUser } from "../../firebase/emulator-auth.mjs";
import { loginStudent } from "./student";

test("生徒と教師がホスト・ゲストを交代し、再読込と終了後も所属と非公開意見を保つ", async ({ page: student, browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ baseURL: new URL(test.info().project.use.baseURL!).origin, viewport: { width: 1440, height: 1000 } });
  const teacher = await context.newPage();
  const errors: string[] = [];
  for (const page of [student, teacher]) page.on("pageerror", e => errors.push(e.message));
  try {
    await loginStudent(student, "alternating-host", { home: false });
    const subject = `role-teacher-${createHash("sha256").update(`${test.info().testId}:${test.info().retry}:${test.info().repeatEachIndex}`).digest("hex").slice(0, 20)}`;
    await emulatorGoogleUser("teacher", subject);
    await teacher.route(/identitytoolkit.*accounts:signInWithIdp/, async route => {
      const data = route.request().postDataJSON(), body = new URLSearchParams(data.postBody);
      const token = JSON.parse(body.get("id_token") ?? "{}");
      body.set("id_token", JSON.stringify({ ...token, sub: subject, email: `${subject}@example.com` }));
      await route.continue({ postData: JSON.stringify({ ...data, postBody: body.toString() }) });
    });
    await teacher.goto("/");
    await teacher.getByRole("button", { name: "テスト用の先生でログイン（エミュレータ）", includeHidden: true }).evaluate(e => (e as HTMLButtonElement).click());
    await expect(teacher).toHaveURL(/\/home$/);

    const rooms: string[] = [];
    for (let round = 0; round < 2; round++) {
      const host = round === 0 ? student : teacher, guest = round === 0 ? teacher : student;
      const theme = `役割を交代して議論する ${round + 1}`;
      await host.goto("/home");
      await expect(host.getByRole("button", { name: "Geminiでテーマを考える", exact: true })).toBeEnabled();
      await host.getByRole("button", { name: "ホストする", exact: true }).click();
      await host.getByLabel("テーマ", { exact: true }).fill(theme);
      await host.getByRole("button", { name: "作成する", exact: true }).click();
      await expect(host).toHaveURL(/\/rooms\//);
      const url = host.url(); rooms.push(url);
      const code = (await host.getByTestId("join-code").textContent())!.replace(/\s/g, "");
      // 同じ自分のコードでもGuestへ降格せず、Host画面へ戻れる。
      await host.goto(`/join?code=${code}`);
      await expect(host.getByText("この部屋を作ったアカウントです", { exact: true })).toBeVisible();
      await host.getByRole("link", { name: "ホストの画面を開く", exact: true }).click();
      await expect(host).toHaveURL(url);
      await host.reload();
      await expect(host.getByRole("button", { name: "議論を開始", exact: true })).toBeVisible();

      await guest.goto(`/join?code=${code}`);
      await guest.getByLabel("参加者1の表示名").fill(`交代する参加者${round + 1}`);
      await guest.getByRole("button", { name: "表示名を保存して進む", exact: true }).click();
      await guest.getByRole("button", { name: "あとで登録する", exact: true }).click();
      const privateOpinion = `本人だけの交代前意見 ${round + 1}`;
      await guest.getByLabel("あなたの意見（本人だけが見られます）").fill(privateOpinion);
      await guest.getByRole("button", { name: "提出する", exact: true }).click();
      await expect(guest.getByRole("heading", { name: "開始を待っています", exact: true })).toBeVisible();
      await expect(host.getByRole("region", { name: "グループの状況" })).toContainText(`交代する参加者${round + 1}`);
      await expect(host.locator("main")).not.toContainText(privateOpinion);
      if (round === 0) await host.screenshot({ path: process.env.T167_EXPLORATORY === "1" ? `.local-data/exploratory/student-host-${test.info().repeatEachIndex}.png` : "../docs/screenshots/open-role-student-host-mobile.png", fullPage: true, scale: "css" });
      await host.getByRole("button", { name: "議論を開始", exact: true }).click();
      await expect(guest.getByRole("timer", { name: "経過時間", exact: true })).toBeVisible();
      await expect(guest.getByRole("link", { name: "ホーム", exact: true })).toHaveCount(0);
      await guest.reload();
      await expect(guest.getByRole("heading", { name: "グループで話し合いましょう", exact: true })).toBeVisible();
      await expect(guest.getByRole("button", { name: "議論を終える", exact: true })).toHaveCount(0);
      await host.getByRole("button", { name: "議論を終える", exact: true }).click();
      await host.getByRole("button", { name: "続行する", exact: true }).click();
      await expect(host.getByRole("heading", { name: "セッション中", exact: true })).toBeVisible();
      await host.getByRole("button", { name: "議論を終える", exact: true }).click();
      await host.getByRole("button", { name: "終了する", exact: true }).click();
      await guest.getByLabel("グループの結論を、あなたはどう理解した？").fill(`本人だけの交代後結論 ${round + 1}`);
      await guest.getByRole("button", { name: "4 おおむね納得", exact: true }).click();
      await guest.getByRole("button", { name: "提出する", exact: true }).click();
      await expect(guest.getByRole("heading", { name: "議論の前と後を比べる", exact: true })).toBeVisible();
      await expect(host.locator("main")).not.toContainText(`本人だけの交代後結論 ${round + 1}`);
    }
    // 過去の部屋へ戻っても「今の固定ロール」で上書きされない。
    for (const [page, own] of [[student, 0], [teacher, 1]] as const) {
      await page.goto("/history");
      await expect(page.locator(".mvp-session-link")).toHaveCount(2);
      await expect(page.locator(".mvp-session-link").filter({ hasText: `役割を交代して議論する ${own + 1}` })).toContainText("ホスト");
      await expect(page.locator(".mvp-session-link").filter({ hasText: `役割を交代して議論する ${2 - own}` })).toContainText("参加者");
      await page.goto(rooms[own]);
      await expect(page.getByRole("region", { name: "結果の公開状態" })).toBeVisible();
    }
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
