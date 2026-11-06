import { expect, test } from "@playwright/test";
import { emulatorGoogleUser } from "../../firebase/emulator-auth.mjs";
import { loginStudent } from "./student";
import { mkdir } from "node:fs/promises";

// 作成は招待された教員（teacher claim）だけ。作成後の権限はセッションごとの members.role で決まる（Docs「サーバーフィードバック」）
test("教師claimのない学生は作成できず、Classroom未連携のまま教員のセッションにParticipantとして参加する", async ({ page, playwright }) => {
  let classroomRequests = 0;
  await page.route("https://classroom.googleapis.com/**", (r) => { classroomRequests++; return r.abort(); });
  const studentSubject = await loginStudent(page);
  await expect(page.getByText("あなたは、生徒ですか？先生ですか？")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /ディスカッションを作る/ })).toHaveCount(0);
  // URLを直接開いても作成の画面は出さない
  await page.goto("/host/new");
  await expect(page.getByRole("status")).toContainText("招待された教員のアカウントだけ");
  await expect(page.getByLabel("テーマ", { exact: true })).toHaveCount(0);
  await page.goto("/teacher");
  await expect(page).toHaveURL(/\/join$/);
  const api = await playwright.request.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const login = async (kind: "teacher" | "student", label: string) => {
      const u = await emulatorGoogleUser(kind, `${label}-${Date.now()}`);
      const headers = { authorization: `Bearer ${u.idToken}` };
      expect((await api.post("/api/sessions", { headers, data: { deviceLabel: label, deviceType: "pc" } })).status()).toBe(201);
      return headers;
    };
    // APIでも、教員でない利用者の作成を断る
    const other = await login("student", "other-student");
    const denied = await api.post("/api/rooms", { headers: other, data: { title: "作れないセッション" } });
    expect(denied.status()).toBe(403);
    expect((await denied.json()).error.code).toBe("teacher_required");
    const teacher = await login("teacher", "mvp-teacher");
    const r = await api.post("/api/rooms", { headers: teacher, data: { title: "Participantとして参加するセッション", groups: 1, groupSelection: "host" } });
    expect(r.status()).toBe(201); const { roomId, joinCode } = await r.json();
    await page.goto(`/join?code=${joinCode}`);
    await expect(page).toHaveURL(/\/rooms\//);
    await expect(page.getByText("教員によるグループの割り当てを待っています。")).toBeVisible();
    await expect(page.getByRole("button", { name: "設定", exact: true })).toHaveCount(0);
    const localStudent = await emulatorGoogleUser("student", studentSubject);
    expect((await api.post(`/api/rooms/${roomId}/groups/assign`, { headers: teacher, data: { uid: localStudent.localId, group: 1 } })).status()).toBe(200);
    await expect(page.getByLabel("あなたの意見")).toBeVisible();
    await page.goto("/home");
    await expect(page.locator(".mvp-session-link").filter({ hasText: "Participantとして参加するセッション" })).toContainText("参加者");
    await mkdir("../docs/screenshots", { recursive: true });
    await page.screenshot({ path: "../docs/screenshots/mvp-home-mobile.png", fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(classroomRequests).toBe(0);
  } finally { await api.dispose(); }
});
