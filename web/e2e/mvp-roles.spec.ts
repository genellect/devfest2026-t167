import { expect, test } from "@playwright/test";
import { emulatorGoogleUser } from "../../firebase/emulator-auth.mjs";
import { loginStudent } from "./student";
import { mkdir } from "node:fs/promises";

// Host/Guestはセッションごとの所属で決まり、教師claimで固定しない。
test("教師claimのない参加者も作成でき、Classroom未連携のままホストのセッションにParticipantとして参加する", async ({ page, playwright }) => {
  let classroomRequests = 0;
  await page.route("https://classroom.googleapis.com/**", (r) => { classroomRequests++; return r.abort(); });
  const studentSubject = await loginStudent(page);
  await expect(page.getByText("あなたは、生徒ですか？先生ですか？")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /議論を作る/ })).toHaveCount(0);
  // 教師claimがない人にも作成画面を表示する
  await page.goto("/host/new");
  await expect(page.getByLabel("テーマ", { exact: true })).toBeVisible();
  await page.goto("/teacher");
  await expect(page).toHaveURL(/\/home$/);
  const api = await playwright.request.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const login = async (kind: "teacher" | "student", label: string) => {
      const u = await emulatorGoogleUser(kind, `${label}-${Date.now()}`);
      const headers = { authorization: `Bearer ${u.idToken}` };
      expect((await api.post("/api/sessions", { headers, data: { deviceLabel: label, deviceType: "pc" } })).status()).toBe(201);
      return headers;
    };
    // APIでも、教師claimがないGoogle利用者が新規作成できる
    const other = await login("student", "other-student");
    const created = await api.post("/api/rooms", { headers: other, data: { title: "作成できるセッション" } });
    expect(created.status()).toBe(201);
    const teacher = await login("teacher", "mvp-teacher");
    const r = await api.post("/api/rooms", { headers: teacher, data: { title: "Participantとして参加するセッション", groups: 1, groupSelection: "host" } });
    expect(r.status()).toBe(201); const { roomId, joinCode } = await r.json();
    await page.goto(`/join?code=${joinCode}`);
    await expect(page).toHaveURL(/\/rooms\//);
    await expect(page.getByText("ホストによるグループの割り当てを待っています。")).toBeVisible();
    await expect(page.getByRole("button", { name: "設定", exact: true })).toHaveCount(0);
    const localStudent = await emulatorGoogleUser("student", studentSubject);
    expect((await api.post(`/api/rooms/${roomId}/groups/assign`, { headers: teacher, data: { uid: localStudent.localId, group: 1 } })).status()).toBe(200);
    await expect(page.getByLabel("あなたの意見")).toBeVisible();
    await page.goto("/home");
    await expect(page.locator(".mvp-session-link").filter({ hasText: "Participantとして参加するセッション" })).toContainText(/参加者|グループ1/);
    await mkdir("../docs/screenshots", { recursive: true });
    await page.screenshot({ path: "../docs/screenshots/mvp-home-mobile.png", fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(classroomRequests).toBe(0);
  } finally { await api.dispose(); }
});
