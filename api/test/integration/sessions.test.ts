import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { emulatorGoogleUser } from '../../../firebase/emulator-auth.mjs';
import { createApp } from '../../src/app.js';
import { mockGemini } from '../../src/gemini.js';
import { createSessions, hashSession } from '../../src/sessions.js';
import { cookieName } from '../../src/session-routes.js';
for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key] ?? '')) throw new Error('専用エミュレータが必要です');
const projectId = process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId?.startsWith('demo-')) throw new Error('デモプロジェクトが必要です');
initializeApp({ projectId });
const db = getFirestore(), auth = getAuth();
let clock = Date.now();
const app = createApp({ db, auth, gemini: mockGemini(), now: () => clock });
const service = createSessions(db, () => clock);
const info = { deviceLabel: '架空の端末', deviceType: 'pc', isSharedDevice: false, classEndsAt: null } as const;
interface Client { token: string; uid: string; cookie: string; id: string }
async function user(kind: 'teacher' | 'student' = 'student') { return emulatorGoogleUser(kind, `session-${randomUUID()}`); }
async function login(account: Awaited<ReturnType<typeof user>>, patch = {}) {
  const r = await request(app).post('/sessions').set('authorization', `Bearer ${account.idToken}`).send({ ...info, ...patch }).expect(201);
  return { token: account.idToken, uid: account.localId, cookie: r.headers['set-cookie'][0].split(';')[0], id: r.body.session.sessionId } satisfies Client;
}
const post = (c: Client, path: string, body = {}) => request(app).post(path).set('authorization', `Bearer ${c.token}`).set('cookie', c.cookie).send(body);
const get = (c: Client, path = '/sessions/current') => request(app).get(path).set('authorization', `Bearer ${c.token}`).set('cookie', c.cookie);
const ref = (c: Client) => db.doc(`users/${c.uid}/sessions/${c.id}`);
beforeEach(() => { clock = Date.now(); });

describe('独自セッションの境界と活動', () => {
  it('作成はCookieだけに秘密値を設定し、安全な表示情報を返す', async () => {
    const u = await user(), r = await request(app).post('/sessions').set('authorization', `Bearer ${u.idToken}`).send(info).expect(201);
    const cookie = r.headers['set-cookie'][0];
    expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Strict'); expect(cookie).toContain('Path=/');
    const secret = cookie.split(';')[0].split('=')[1];
    expect(r.body.session.sessionId).toBe(hashSession(secret)); expect(JSON.stringify(r.body)).not.toContain(secret);
    expect(r.body.session.uid).toBeUndefined();
    const s = (await db.doc(`users/${u.localId}/sessions/${r.body.session.sessionId}`).get()).data()!;
    expect(s.userAgentSummary).toBe('pc'); expect(s.createdAt).toBeInstanceOf(Timestamp);
  });
  it('6日23時間59分は有効で168時間ちょうどに失効する', async () => {
    const c = await login(await user()); clock += 168 * 3600_000 - 60_000;
    await get(c).expect(200); clock += 60_000;
    expect((await get(c).expect(401)).body.error).toMatchObject({ code: 'session_revoked', reason: 'idle_expired' });
    expect((await ref(c).get()).get('revokeReason')).toBe('idle_expired');
  });
  it('取得と新しいIDトークンでは延長せず、明示的な操作だけサーバー時刻で更新する', async () => {
    const c = await login(await user()), original = (await ref(c).get()).get('lastActivityAt').toMillis();
    clock += 60_000; await get(c).expect(200); await get(c, '/sessions').expect(200);
    expect((await ref(c).get()).get('lastActivityAt').toMillis()).toBe(original);
    await post(c, '/sessions/activity').expect(200);
    expect((await ref(c).get()).get('lastActivityAt').toMillis()).toBe(clock);
    expect((await ref(c).get()).get('expiresAt').toMillis()).toBe(clock + 168 * 3600_000);
  });
  it('成功した業務操作は更新し、404/不正操作では延長しない', async () => {
    const c = await login(await user('teacher')); clock += 1000;
    await post(c, '/rooms', { title: 'テスト授業' }).expect(201);
    expect((await ref(c).get()).get('lastActivityAt').toMillis()).toBe(clock);
    clock += 1000; await post(c, '/rooms/join', { code: 'ZZZZZZ' }).expect(404);
    expect((await ref(c).get()).get('lastActivityAt').toMillis()).toBe(clock - 1000);
  });
  it('Cookieなし/改ざん/別ユーザーとの組み合わせ/クライアント指定IDを拒否する', async () => {
    const c = await login(await user()), other = await login(await user());
    await request(app).get('/sessions/current').set('authorization', `Bearer ${c.token}`).expect(401);
    await get({ ...c, cookie: `${cookieName()}=bad` }).expect(401);
    await get({ ...c, cookie: other.cookie }).expect(401);
    await post(c, '/sessions/revoke', { sessionId: other.id }).expect(404);
    await post(c, '/sessions', { ...info, sessionId: other.id }).expect(400);
    await get(other).expect(200);
  });
  it('Firebaseトークンだけを更新しても失効した独自セッションを復元できない', async () => {
    const u = await user(), c = await login(u); await login(u);
    const r = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/securetoken.googleapis.com/v1/token?key=fake`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: u.refreshToken }) });
    const fresh = await r.json(); expect(fresh.id_token).toBeTruthy();
    await get({ ...c, token: fresh.id_token }).expect(401);
    await post({ ...c, token: fresh.id_token }, '/rooms/join', { code: 'DEMO01' }).expect(401);
  });
  it('cross-site操作、古い認証、重複Cookieを拒否する', async () => {
    const c = await login(await user());
    await post(c, '/sessions/activity').set('sec-fetch-site', 'cross-site').expect(403);
    await get({ ...c, cookie: `${c.cookie}; ${c.cookie}` }).expect(401);
    clock += 5 * 60_000; await post(c, '/sessions', info).expect(401);
  });
});

describe('同時ログインと失効', () => {
  it('生徒の2台目を許可して1台目を失効させる', async () => {
    const u = await user(), a = await login(u), b = await login(u);
    expect((await get(a).expect(401)).body.error.reason).toBe('replaced'); await get(b).expect(200);
    const index = await db.doc(`users/${a.uid}/sessionControl/state`).get(); expect(index.get('activeIds')).toEqual([b.id]);
  });
  it('教師claimがあっても2台目で旧端末が失効し、上限は全員1台', async () => {
    const u = await user('teacher'), a = await login(u); clock += 1000; const b = await login(u);
    await get(a).expect(401); await get(b).expect(200);
    expect((await ref(b).get()).get('role')).toBeUndefined();
  });
  it('同時に5台がログインしても生徒1台の上限を超えない', async () => {
    const u = await user(), clients = await Promise.all(Array.from({ length: 5 }, () => login(u)));
    const snapshots = await Promise.all(clients.map((c) => ref(c).get()));
    expect(snapshots.filter((s) => !s.get('revokedAt'))).toHaveLength(1);
    expect((await db.doc(`users/${u.localId}/sessionControl/state`).get()).get('activeIds')).toHaveLength(1);
  }, 20_000);
  it('個別ログアウトと全端末ログアウトを強制する', async () => {
    const u = await user('teacher'), a = await login(u), b = await login(u);
    await post(b, '/sessions/revoke', { sessionId: b.id }).expect(200); await get(b).expect(401); await get(a).expect(401);
    const c = await login(u); await post(c, '/sessions/logout-all').expect(200); await get(a).expect(401); await get(c).expect(401);
    const d = await login(u); expect((await post(d, '/sessions/logout').expect(200)).headers['set-cookie'][0]).toContain('Expires='); await get(d).expect(401);
  });
  it('共用端末は15分無操作でサーバーがロックし、通常の活動では解除できない', async () => {
    const c = await login(await user(), { isSharedDevice: true, classEndsAt: clock + 3600_000 });
    clock += 15 * 60_000 - 1; await get(c).expect(200); clock++;
    await get(c).expect(423); await post(c, '/sessions/activity').expect(423); await post(c, '/rooms/join', { code: 'DEMO01' }).expect(423);
    await post(c, '/sessions/unlock').expect(401); // 自動refresh/同じ古いauth_timeで解除不可
  });
  it('共用端末の授業終了と設定の解除・延長を検査する', async () => {
    const c = await login(await user());
    await post(c, '/sessions/shared-device', { isSharedDevice: true, classEndsAt: null }).expect(400);
    await post(c, '/sessions/shared-device', { isSharedDevice: true, classEndsAt: clock + 60_000 }).expect(200);
    await post(c, '/sessions/shared-device', { isSharedDevice: false, classEndsAt: null }).expect(403);
    await post(c, '/sessions/shared-device', { isSharedDevice: true, classEndsAt: clock + 120_000 }).expect(403);
    clock += 60_000; expect((await get(c).expect(401)).body.error.reason).toBe('class_ended');
  });
  it('新しい本人確認でCookieを回転し、旧Cookieは無効になる', async () => {
    const u = await user(), c = await login(u, { isSharedDevice: true, classEndsAt: clock + 3600_000 });
    await ref(c).update({ lockedAt: Timestamp.fromMillis(clock - 1000) });
    const unlocked = await post(c, '/sessions/unlock').expect(200);
    const rotated = unlocked.headers['set-cookie'][0].split(';')[0]; expect(rotated).not.toBe(c.cookie);
    await get(c).expect(401); await get({ ...c, cookie: rotated }).expect(200);
    expect(unlocked.body.session.isSharedDevice).toBe(true);
  });
  it('学校ポリシーは同じ学校の管理者だけが操作し、管理者も2台まで', async () => {
    const u = await user(), decoded = await auth.verifyIdToken(u.idToken), school = `school-${randomUUID()}`;
    const adminToken = { ...decoded, schoolId: school, schoolAdmin: true, auth_time: Math.floor(clock / 1000) };
    const target = await user(); await auth.setCustomUserClaims(target.localId, { schoolId: school });
    const fakeAuth = { verifyIdToken: async () => adminToken, getUser: auth.getUser.bind(auth) } as typeof auth;
    const adminApp = createApp({ db, auth: fakeAuth, gemini: mockGemini(), now: () => clock });
    const created = await request(adminApp).post('/sessions').set('authorization', 'Bearer synthetic').send(info).expect(201);
    const cookie = created.headers['set-cookie'][0].split(';')[0];
    const adminReq = (method: 'get' | 'put' | 'post', path: string) => request(adminApp)[method](path).set('authorization', 'Bearer synthetic').set('cookie', cookie);
    await adminReq('get', `/schools/${school}/security-policy`).expect(200);
    await adminReq('put', `/schools/${school}/security-policy`).send({ idleDays: 2, maxConcurrentSessions: 2, newDeviceNotifications: true }).expect(200);
    await adminReq('put', `/schools/${school}/security-policy`).send({ studentLimit: 9 }).expect(400);
    await adminReq('get', '/schools/other/security-policy').expect(403);
    await adminReq('post', `/schools/${school}/users/${target.localId}/sessions/revoke`).send({}).expect(200);
    await adminReq('post', `/schools/${school}/users/unknown/sessions/revoke`).send({}).expect(404);
    await adminReq('post', `/schools/${school}/users/${u.localId}/sessions/revoke`).send({}).expect(404);
    clock += 1; const a = await service.create(adminToken, info);
    clock += 1; const b = await service.create(adminToken, info);
    expect((await db.doc(`users/${u.localId}/sessions/${created.body.session.sessionId}`).get()).get('revokedAt')).toBeTruthy();
    await service.validate(adminToken, a.secret); await service.validate(adminToken, b.secret);
    expect((await service.policy(adminToken)).idleDays).toBe(2);
  });
  it('通知アダプターが失敗しても作成済みセッションを失敗扱いにしない', async () => {
    const u = await user(), decoded = await auth.verifyIdToken(u.idToken), schoolId = `notify-${randomUUID()}`;
    await db.doc(`schools/${schoolId}/security/policy`).set({ newDeviceNotifications: true });
    const notifications = { newSession: vi.fn(async () => { throw new Error('synthetic-down'); }) };
    const sessions = createSessions(db, () => clock, notifications);
    const r = await sessions.create({ ...decoded, schoolId }, info); await sessions.validate({ ...decoded, schoolId }, r.secret);
    expect(notifications.newSession).toHaveBeenCalledOnce();
  });
  it('監査ログに個人情報・生Cookie・トークン・端末ラベルを出さない', async () => {
    const c = await login(await user()); await post(c, '/sessions/logout-all').expect(200);
    await request(app).get('/sessions/current').set('authorization', 'Bearer invalid').expect(401);
    const logs = (await db.collection('securityEvents').get()).docs.map((s) => s.data());
    expect(logs.some((l) => l.event === 'login_success')).toBe(true); expect(logs.some((l) => l.event === 'logout_all')).toBe(true);
    for (const log of logs) expect(Object.keys(log).every((key) => ['event', 'at', 'deleteAt', 'subjectId', 'reason'].includes(key))).toBe(true);
    const text = JSON.stringify(logs); expect(text).not.toContain(c.uid); expect(text).not.toContain(c.token); expect(text).not.toContain(c.cookie.split('=')[1]); expect(text).not.toContain(info.deviceLabel);
  });
});

describe('ライブ配信と既存データの認可', () => {
  async function streamClient(c: Client, roomId: string) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const port = (server.address() as { port: number }).port, controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}/rooms/${roomId}/live`, { headers: { authorization: `Bearer ${c.token}`, cookie: c.cookie }, signal: controller.signal });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader(), decoder = new TextDecoder(); let text = '';
    async function until(condition: (text: string) => boolean) {
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try { while (!condition(text)) { const part = await reader.read(); if (part.done) break; text += decoder.decode(part.value); } }
      finally { clearTimeout(timeout); }
      expect(condition(text), '配信の受信条件').toBe(true); return text;
    }
    async function close() { controller.abort(); await reader.cancel().catch(() => {}); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
    return { until, close };
  }
  async function seed(c: Client, role: string) {
    const room = db.collection('sessions').doc();
    await room.set({ title: 'live-test', groups: 2, phase: 'discussing', createdAt: Timestamp.now(), resultsPublished: true });
    await room.collection('members').doc(c.uid).set({ uid: c.uid, status: 'active', role, group: 1, groupId: '1' });
    await room.collection('members').doc('outsider-peer').set({ role: 'participant', group: 2, status: 'active', name: 'OTHER-GROUP-MEMBER' });
    await room.collection('messages').doc('other-message').set({ uid: 'outsider-peer', text: 'OTHER-GROUP-MESSAGE', createdAt: Timestamp.now() });
    await room.update({ 'groupState.2': { note: 'OTHER-GROUP-STATE' } });
    await room.collection('privateOpinions').doc(c.uid).set({ text: 'OWN-PRIVATE-OPINION' });
    await room.collection('privateOpinions').doc('other').set({ text: 'OTHER-PRIVATE-OPINION' });
    await room.collection('consensusStatements').doc(c.uid).set({ text: 'OWN-STATEMENT' });
    await room.collection('insights').doc('pending').set({ summary: 'UNAPPROVED-INSIGHT', status: 'pending' });
    await room.collection('insights').doc('dismissed').set({ summary: 'DISMISSED-INSIGHT', status: 'dismissed' });
    await room.collection('insights').doc('approved').set({ summary: 'APPROVED-INSIGHT', status: 'approved', group: 1 });
    await room.collection('insights').doc('room-wide').set({ summary: 'ROOM-WIDE-INSIGHT', status: 'approved' });
    await room.collection('insights').doc('other-group').set({ summary: 'OTHER-GROUP-INSIGHT', status: 'approved', group: 2 });
    await room.collection('results').doc('group-1').set({ label: 'OWN-GROUP-RESULT' });
    await room.collection('results').doc('group-2').set({ label: 'OTHER-GROUP-RESULT' });
    await room.collection('results').doc('summary').set({ label: 'CLASS-SUMMARY' });
    return room;
  }
  it('生徒への配信は本人の意見・同じグループ結果・承認済み提案だけ', async () => {
    const c = await login(await user()), room = await seed(c, 'participant');
    await get(c, `/rooms/${room.id}/me`).expect(200);
    const stream = await streamClient(c, room.id);
    try {
      const text = await stream.until((text) => text.includes('OWN-PRIVATE-OPINION') && text.includes('OWN-STATEMENT') && text.includes('OWN-GROUP-RESULT') && text.includes('APPROVED-INSIGHT') && text.includes('ROOM-WIDE-INSIGHT'));
      for (const forbidden of ['OTHER-PRIVATE-OPINION', 'UNAPPROVED-INSIGHT', 'DISMISSED-INSIGHT', 'OTHER-GROUP-INSIGHT', 'OTHER-GROUP-RESULT', 'CLASS-SUMMARY', 'OTHER-GROUP-MEMBER', 'OTHER-GROUP-MESSAGE', 'OTHER-GROUP-STATE']) expect(text).not.toContain(forbidden);
      await post(c, `/rooms/${room.id}/messages`, { text: 'MY-MESSAGE' }).expect(200);
      await stream.until((text) => text.includes('MY-MESSAGE'));
      await room.update({ phase: 'closed' }); await post(c, `/rooms/${room.id}/messages`, { text: 'late' }).expect(409);
    } finally { await stream.close(); }
  });
  it('ライブ接続のまま公開停止すると結果を消し、再公開で現在の結果だけを送る', async () => {
    const c = await login(await user()), room = await seed(c, 'participant'), stream = await streamClient(c, room.id);
    try {
      await stream.until((v) => v.includes('OWN-GROUP-RESULT'));
      await room.update({ resultsPublished: false });
      await stream.until((v) => v.includes(`"${room.path}/results/group-1":null`));
      await room.collection('results').doc('group-1').set({ label: 'WITHHELD-RESULT' });
      await room.update({ title: 'publication-stopped' });
      const hidden = await stream.until((v) => v.includes('publication-stopped'));
      expect(hidden).not.toContain('WITHHELD-RESULT');
      await room.update({ resultsPublished: true });
      await stream.until((v) => v.includes('WITHHELD-RESULT'));
    } finally { await stream.close(); }
  });
  it('教師にも非公開意見を送らず、開いた配信でも失効を検査する', async () => {
    const c = await login(await user('teacher')), room = await seed(c, 'host'), stream = await streamClient(c, room.id);
    try {
      const text = await stream.until((v) => v.includes('CLASS-SUMMARY') && v.includes('UNAPPROVED-INSIGHT'));
      expect(text).not.toContain('OWN-PRIVATE-OPINION'); expect(text).not.toContain('OTHER-PRIVATE-OPINION');
      await post(c, '/sessions/logout').expect(200); await room.update({ title: 'after-revoke' });
      const ended = await stream.until((v) => v.includes('event: failure'));
      expect(ended).toContain('session_revoked'); expect(ended).not.toContain('after-revoke');
    } finally { await stream.close(); }
  });
  it('話者集計はHostが許可した所属グループだけに、議論の終了後に結果を公開したときだけ配信する', async () => {
    const c = await login(await user()), room = await seed(c, 'participant');
    await room.collection('speaking').doc('1').set({ label: 'OWN-SPEAKING' });
    await room.collection('speaking').doc('2').set({ label: 'OTHER-SPEAKING' });
    await room.collection('voiceProfiles').doc('private').set({ embedding: ['PRIVATE-VOICE-VECTOR'] });
    const stream = await streamClient(c, room.id);
    try {
      const hidden = await stream.until((s) => s.includes(`"${room.path}/speaking/1":null`));
      expect(hidden).not.toContain('OWN-SPEAKING');
      // 許可しても、議論中は届けない（学生の画面には議論中の発言率を出さない）
      await room.update({ participantView: { speaking: true }, title: 'speaking-live' });
      const live = await stream.until((s) => s.includes('speaking-live'));
      expect(live).not.toContain('OWN-SPEAKING');
      await room.update({ endedAt: Timestamp.now(), resultsPublished: false });
      // 終了後は本人の時間と割合だけ：同じグループのほかの人の名前・時間・直近の発言者は渡さない
      await room.collection('members').doc(c.uid).update({ attendees: [{ id: 'own-attendee', displayName: 'OWN-NAME' }] });
      await room.collection('speaking').doc('1').set({
        group: 1, source: 'mock', processedMs: 120_000, unknownMs: 1000,
        talkMs: { 'own-attendee': 4000, 'peer-attendee': 5000 },
        members: [{ uid: 'own-attendee', label: 'FINAL-SPEAKING' }, { uid: 'peer-attendee', label: 'PEER-IN-SAME-GROUP' }],
        latest: { uid: 'peer-attendee', label: 'PEER-IN-SAME-GROUP', confidence: 0.9 },
        timeline: [{ talkMs: { 'own-attendee': 4000, 'peer-attendee': 5000 }, unknownMs: 1000 }],
      });
      await room.update({ title: 'speaking-withheld' });
      const withheld = await stream.until((s) => s.includes('speaking-withheld'));
      expect(withheld).not.toContain('FINAL-SPEAKING');
      await room.update({ resultsPublished: true });
      const published = await stream.until((s) => s.includes('FINAL-SPEAKING'));
      expect(published).not.toContain('OTHER-SPEAKING'); expect(published).not.toContain('PRIVATE-VOICE-VECTOR');
      expect(published).not.toContain('PEER-IN-SAME-GROUP'); expect(published).not.toContain('peer-attendee');
      expect(published).toContain('"scope":"self"'); expect(published).toContain('"totalMs":10000');
      // 2人のグループでは、相手の時間（線がそのまま相手の推移になる）を送らない
      expect(published).not.toContain('othersMs');
      // 3人以上なら、ほかのメンバーの時間を、名前とIDを外し、発言時間の多い順の配列で送る
      await room.collection('speaking').doc('1').set({
        group: 1, source: 'mock', processedMs: 120_000, unknownMs: 1000,
        talkMs: { 'own-attendee': 4000, 'peer-attendee': 5000, 'third-attendee': 7000 },
        members: [{ uid: 'own-attendee', label: 'FINAL-SPEAKING' }, { uid: 'peer-attendee', label: 'PEER-IN-SAME-GROUP' }, { uid: 'third-attendee', label: 'THIRD-IN-SAME-GROUP' }],
        latest: null,
        timeline: [{ talkMs: { 'own-attendee': 4000, 'peer-attendee': 5000, 'third-attendee': 7000 }, unknownMs: 1000 }],
      });
      const three = await stream.until((s) => s.includes('"othersMs"'));
      expect(three).toContain('"othersMs":[7000,5000]');
      expect(three).not.toContain('THIRD-IN-SAME-GROUP'); expect(three).not.toContain('third-attendee');
    } finally { await stream.close(); }
  });
  it('メンバー外と失効済みセッションの配信・所属取得を拒否する', async () => {
    const c = await login(await user()), other = await login(await user()), room = await seed(c, 'participant');
    await get(other, `/rooms/${room.id}/live`).expect(403); await get(other, `/rooms/${room.id}/me`).expect(403);
    await post(c, '/sessions/logout').expect(200); await get(c, `/rooms/${room.id}/live`).expect(401);
  });
});
