import { enterCurrentSession } from "./current-session";
import { expect, test } from "@playwright/test";
import { emulatorGoogleUser } from "../../firebase/emulator-auth.mjs";
import { loginStudent } from "./student";
import { mkdir } from "node:fs/promises";

// 全員が作成でき、Host/Participantは部屋ごとの所属で決まる。
test("教師claimなしで作成画面を開け、別の部屋ではParticipantとして参加する", async ({ page, playwright }) => {
  let classroomRequests = 0;
  await page.route("https://classroom.googleapis.com/**", (r) => { classroomRequests++; return r.abort(); });
  const studentSubject = await loginStudent(page);
  await expect(page.getByRole("link", { name: "ホストする", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "ホストする", exact: true }).click();
  await expect(page.getByLabel("テーマ", { exact: true })).toBeVisible();
  await page.getByLabel("テーマ", { exact: true }).fill("生徒が作る議論");
  await page.getByRole("button", { name: "セッションを作成" }).click();
  await expect(page).toHaveURL(/\/rooms\//);
  await expect(page.getByRole("button", { name: "設定", exact: true })).toBeVisible();
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
    // 別のGoogle利用者にも作成を許可し、本人の新規部屋だけにHostを付与する。
    const other = await login("student", "other-student");
    const created = await api.post("/api/rooms", { headers: other, data: { flowVersion: 1, title: "生徒のセッション" } });
    expect(created.status()).toBe(201);
    const teacher = await login("teacher", "mvp-teacher");
    const r = await api.post("/api/rooms", { headers: teacher, data: { flowVersion: 1, title: "Participantとして参加するセッション", groups: 1, groupSelection: "host" } });
    expect(r.status()).toBe(201); const { roomId, joinCode } = await r.json();
    await page.goto(`/join?code=${joinCode}`);
    await expect(page).toHaveURL(/\/rooms\//);
  await enterCurrentSession(page);
    await expect(page.getByText("グループの割り当てを待っています。", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "設定", exact: true })).toHaveCount(0);
    const localStudent = await emulatorGoogleUser("student", studentSubject);
    expect((await api.post(`/api/rooms/${roomId}/groups/assign`, { headers: teacher, data: { uid: localStudent.localId, group: 1 } })).status()).toBe(200);
    await expect(page.getByRole("heading", { name: "参加できました", exact: true })).toBeVisible();
    await page.goto("/home");
  await page.getByRole("button", { name: "メニュー", exact: true }).click();
  await page.getByRole("dialog", { name: "ホームのメニュー", exact: true }).getByRole("link", { name: "履歴", exact: true }).click();
    await expect(page.getByRole("list", { name: "議論の履歴", exact: true }).getByRole("link").filter({ hasText: "グループ1" })).toContainText(/参加者|グループ1/);
    await mkdir("../docs/screenshots", { recursive: true });
    await page.screenshot({ path: "../docs/screenshots/mvp-home-mobile.png", fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(classroomRequests).toBe(0);
  } finally { await api.dispose(); }
});
