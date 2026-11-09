import { expect, it, beforeEach } from 'vitest';
import request from 'supertest';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { emulatorGoogleUser } from '../../../firebase/emulator-auth.mjs';
import { createApp } from '../../src/app.js';
import { mockGemini } from '../../src/gemini.js';
import { endDiscussion } from '../../src/discussion-lifecycle.js';
import { wave } from '../fixtures/audio.js';
const projectId = process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId?.startsWith('demo-')) throw new Error('デモプロジェクトだけで検査します');
initializeApp({ projectId }); const db = getFirestore(), auth = getAuth();
let now = Date.now(), silent = false;
const voice = { version: 'test-v1', source: 'mock' as const, extract: async () => ({ embedding: silent ? null : Array(16).fill(0.25), speechMs: silent ? 0 : 8000 }) };
const deps = { db, auth, gemini: mockGemini(), voice, now: () => now }, app = createApp(deps);
beforeEach(() => { now = Date.now(); silent = false; });
async function client(kind: 'teacher' | 'student' = 'student') {
  const u = await emulatorGoogleUser(kind, `guided-${randomUUID()}`);
  const session = await request(app).post('/sessions').set('authorization', `Bearer ${u.idToken}`).send({ deviceLabel: 'テスト端末', deviceType: 'tablet' }).expect(201);
  const cookie = session.headers['set-cookie'][0].split(';')[0], headers = { authorization: `Bearer ${u.idToken}`, cookie };
  return { uid: u.localId, headers, post: (path: string, body = {}) => request(app).post(path).set(headers).send(body), get: (path: string) => request(app).get(path).set(headers) };
}
async function setup() {
  const h = await client('teacher'), p = await client();
  const r = (await h.post('/rooms', { title: 'MVP', theme: 'テーマ', minutes: 1, groups: 1, flowVersion: 1, participantView: { theme: true, timer: true, members: true } }).expect(201)).body;
  await p.post('/rooms/join', { code: r.joinCode }).expect(200);
  return { h, p, ...r } as { h: Awaited<ReturnType<typeof client>>; p: Awaited<ReturnType<typeof client>>; roomId: string; joinCode: string };
}
const member = (roomId: string, uid: string) => db.doc(`sessions/${roomId}/members/${uid}`);
async function enroll(p: Awaited<ReturnType<typeof client>>, roomId: string, mode: 'personal' | 'shared' = 'personal', names = ['表示名']) {
  await p.post(`/rooms/${roomId}/onboarding`, { mode, names }).expect(200);
  const rows = (await member(roomId, p.uid).get()).get('attendees') as { id: string }[];
  for (const a of rows) await request(app).post(`/rooms/${roomId}/voice/${a.id}?consent=1`).set(p.headers).set('content-type', 'audio/pcm').send(Buffer.alloc(9 * 32000, 1)).expect(200);
}
it('個人端末はGoogle UIDに紐付いた声の特徴を初回だけ登録し、別セッションでも再利用する', async () => {
  const { h, p, roomId } = await setup(); await enroll(p, roomId);
  expect((await member(roomId, p.uid).get()).get('ready')).toBe(true);
  const profile = await db.doc(`users/${p.uid}/voiceProfiles/default`).get();
  expect(profile.get('embedding')).toHaveLength(16); expect(profile.get('audio')).toBeUndefined();
  const r = (await h.post('/rooms', { title: '次回', groups: 1, flowVersion: 1 }).expect(201)).body;
  await p.post('/rooms/join', { code: r.joinCode }).expect(200);
  expect((await p.post(`/rooms/${r.roomId}/onboarding`, { mode: 'personal', names: ['次の表示名'] }).expect(200)).body.reused).toBe(true);
  expect((await member(r.roomId, p.uid).get()).get('ready')).toBe(true);
  await p.post('/voice-profile/delete').expect(200); expect((await profile.ref.get()).exists).toBe(false);
});
it('共用端末は全員を毎回登録し、終了時にその回の声の特徴だけ削除する', async () => {
  const { h, p, roomId } = await setup(); await enroll(p, roomId, 'shared', ['A', 'B']);
  expect((await db.collection(`sessions/${roomId}/voiceProfiles`).get()).size).toBe(2);
  expect((await db.doc(`users/${p.uid}/voiceProfiles/default`).get()).exists).toBe(false);
  await h.post(`/rooms/${roomId}/phase`, { to: 'discussing' }).expect(200);
  await p.post(`/rooms/${roomId}/finish`).expect(403);
  await h.post(`/rooms/${roomId}/finish`).expect(200);
  expect((await db.collection(`sessions/${roomId}/voiceProfiles`).get()).empty).toBe(true);
  expect((await db.doc(`sessions/${roomId}`).get()).get('endReason')).toBe('host');
  await h.get(`/rooms/${roomId}/results/session-summary`).expect(200);
  await p.get(`/rooms/${roomId}/results/session-summary`).expect(403);
});
it('未登録・無音・途中の登録では開始できず、Hostの開始後は登録済みの人の登録を変えさせない', async () => {
  const { h, p, roomId } = await setup();
  await h.post(`/rooms/${roomId}/phase`, { to: 'discussing' }).expect(409);
  await p.post(`/rooms/${roomId}/onboarding`, { mode: 'personal', names: ['A', 'B'] }).expect(400);
  await h.post(`/rooms/${roomId}/onboarding`, { mode: 'personal', names: ['Host'] }).expect(403);
  await p.post(`/rooms/${roomId}/onboarding`, { mode: 'shared', names: ['A', 'B'] }).expect(200);
  const rows = (await member(roomId, p.uid).get()).get('attendees');
  silent = true;
  await request(app).post(`/rooms/${roomId}/voice/${rows[0].id}?consent=1`).set(p.headers).set('content-type', 'audio/pcm').send(Buffer.alloc(9 * 32000)).expect(400);
  silent = false;
  await request(app).post(`/rooms/${roomId}/voice/missing?consent=1`).set(p.headers).set('content-type', 'audio/pcm').send(Buffer.alloc(9 * 32000)).expect(404);
  await request(app).post(`/rooms/${roomId}/voice/${rows[0].id}?consent=1`).set(p.headers).set('content-type', 'audio/pcm').send(Buffer.alloc(10)).expect(400);
  for (const row of rows) await request(app).post(`/rooms/${roomId}/voice/${row.id}?consent=1`).set(p.headers).set('content-type', 'audio/pcm').send(Buffer.alloc(9 * 32000)).expect(200);
  await h.post(`/rooms/${roomId}/phase`, { to: 'discussing' }).expect(200);
  await p.post(`/rooms/${roomId}/onboarding`, { mode: 'personal', names: ['変更'] }).expect(409);
  await request(app).post(`/rooms/${roomId}/voice/${rows[0].id}?consent=1`).set(p.headers).set('content-type', 'audio/pcm').send(Buffer.alloc(9 * 32000)).expect(409);
});
it('議論の途中からも参加できる。表示名だけを登録し、声は議論中の推定に加えない。終了後は新しく参加できない', async () => {
  const { h, p, roomId, joinCode } = await setup(); await enroll(p, roomId);
  // 前の回で声を登録した人が、途中から参加する
  const late = await client();
  const before = (await h.post('/rooms', { title: '前の回', groups: 1, flowVersion: 1 }).expect(201)).body;
  await late.post('/rooms/join', { code: before.joinCode }).expect(200);
  await enroll(late, before.roomId);
  await h.post(`/rooms/${roomId}/phase`, { to: 'discussing' }).expect(200);
  expect((await late.post('/rooms/join', { code: joinCode }).expect(200)).body).toEqual({ roomId });
  const joined = await member(roomId, late.uid).get();
  expect(joined.get('group')).toBe(1); expect(joined.get('status')).toBe('active');
  expect((await db.doc(`sessions/${roomId}`).get()).get('groupState')['1'].total).toBe(2);
  expect((await late.post(`/rooms/${roomId}/onboarding`, { mode: 'personal', names: ['途中の人'] }).expect(200)).body.reused).toBe(false);
  const rows = (await member(roomId, late.uid).get()).get('attendees') as { id: string; voiceRegistered: boolean }[];
  expect(rows.map((r) => r.voiceRegistered)).toEqual([false]);
  await late.post(`/rooms/${roomId}/onboarding`, { mode: 'personal', names: ['もう一度'] }).expect(409);
  await request(app).post(`/rooms/${roomId}/voice/${rows[0].id}?consent=1`).set(late.headers).set('content-type', 'audio/pcm').send(Buffer.alloc(9 * 32000, 1)).expect(409);
  await late.post(`/rooms/${roomId}/messages`, { text: '途中からの発言' }).expect(200);
  await h.post(`/rooms/${roomId}/finish`).expect(200);
  await (await client()).post('/rooms/join', { code: joinCode }).expect(409);
  expect((await late.post('/rooms/join', { code: joinCode }).expect(200)).body).toEqual({ roomId });
});
it('未準備のGuestがいても、Hostが確認すればそのGuestを外して開始できる', async () => {
  const { h, p, roomId } = await setup(); await enroll(p, roomId);
  const late = await client();
  await late.post('/rooms/join', { code: (await db.doc(`sessions/${roomId}`).get()).get('joinCode') }).expect(200);
  const refused = await h.post(`/rooms/${roomId}/phase`, { to: 'discussing' }).expect(409);
  expect(refused.body.error).toMatchObject({ code: 'guests_not_ready', notReady: 1 });
  await p.post(`/rooms/${roomId}/phase`, { to: 'discussing', excludeNotReady: true }).expect(403);
  await h.post(`/rooms/${roomId}/phase`, { to: 'discussing', excludeNotReady: true }).expect(200);
  expect((await member(roomId, late.uid).get()).get('status')).toBe('inactive');
  expect((await member(roomId, p.uid).get()).get('status')).toBe('active');
  await late.get(`/rooms/${roomId}/me`).expect(403);
  await p.post(`/rooms/${roomId}/messages`, { text: '開始後の発言' }).expect(200);
  expect((await db.doc(`sessions/${roomId}`).get()).get('groupState')['1'].total).toBe(1);
});
it('参加済みのGuestは、開始後も終了後も同じコードで部屋に戻れる。外されたGuestと、終了後の新しい参加者は入れない', async () => {
  const { h, p, roomId, joinCode } = await setup(); await enroll(p, roomId);
  const late = await client();
  await late.post('/rooms/join', { code: joinCode }).expect(200);
  await h.post(`/rooms/${roomId}/phase`, { to: 'discussing', excludeNotReady: true }).expect(200);
  expect((await p.post('/rooms/join', { code: joinCode }).expect(200)).body).toEqual({ roomId });
  await late.post('/rooms/join', { code: joinCode }).expect(403);
  await h.post(`/rooms/${roomId}/finish`).expect(200);
  expect((await p.post('/rooms/join', { code: joinCode }).expect(200)).body).toEqual({ roomId });
  await (await client()).post('/rooms/join', { code: joinCode }).expect(409);
  expect((await member(roomId, p.uid).get()).get('status')).toBe('active');
});
it('1本の流れ：開始前の事前意見、音声登録なしでの開始、終了後の合意の一文から、グループの結果と指標が出る', async () => {
  const h = await client('teacher'), a = await client(), b = await client();
  const r = (await h.post('/rooms', { title: '大学のAI利用', theme: '大学のAI利用', className: '2年3組', flowVersion: 1 }).expect(201)).body;
  const room = db.doc(`sessions/${r.roomId}`);
  expect((await room.get()).get('className')).toBe('2年3組');
  expect((await room.get()).get('minutes')).toBeUndefined();
  for (const [p, name] of [[a, 'A'], [b, 'B']] as const) {
    await p.post('/rooms/join', { code: r.joinCode }).expect(200);
    await p.post(`/rooms/${r.roomId}/onboarding`, { mode: 'personal', names: [name] }).expect(200);
    await p.post(`/rooms/${r.roomId}/opinion`, { text: `${name}の非公開の意見` }).expect(200);
  }
  await h.post(`/rooms/${r.roomId}/phase`, { to: 'discussing' }).expect(200);
  expect((await room.get()).get('endsAt')).toBeUndefined();
  await a.post(`/rooms/${r.roomId}/messages`, { text: '費用の話をした' }).expect(200);
  expect((await h.post(`/rooms/${r.roomId}/analyze`).expect(200)).body.suggested).toBeGreaterThan(0);
  await h.post(`/rooms/${r.roomId}/finish`).expect(200);
  await a.post(`/rooms/${r.roomId}/statement`, { text: '申告すれば使ってよい', agreement: 4 }).expect(200);
  await b.post(`/rooms/${r.roomId}/statement`, { text: '許可があれば使ってよい', agreement: 4 }).expect(200);
  const group = await db.doc(`sessions/${r.roomId}/results/group-1`).get();
  expect(group.get('clusters')).toHaveLength(2);
  const summary = (await h.post(`/rooms/${r.roomId}/consensus/analyze`).expect(200)).body;
  expect(summary.metrics.alignmentRate).toBe(0.5);
  expect(JSON.stringify(summary)).not.toContain('非公開の意見');
});
it('グループはサーバーが決め、1グループが100人になると次のグループに入る', async () => {
  const h = await client('teacher');
  const r = (await h.post('/rooms', { title: '大人数', theme: '大人数', flowVersion: 1 }).expect(201)).body;
  const batch = db.batch();
  for (let i = 0; i < 100; i++) batch.set(db.doc(`sessions/${r.roomId}/members/seed-${i}`), { uid: `seed-${i}`, role: 'participant', group: 1, groupId: '1', status: 'active' });
  await batch.commit();
  const p = await client();
  await p.post('/rooms/join', { code: r.joinCode }).expect(200);
  expect((await member(r.roomId, p.uid).get()).get('group')).toBe(2);
  expect((await db.doc(`sessions/${r.roomId}`).get()).get('groups')).toBe(2);
  expect((await db.doc(`sessions/${r.roomId}/groups/2`).get()).exists).toBe(true);
});
it('作成から3時間で失効したセッションには、参加も書き込みもできない', async () => {
  const { roomId, joinCode, p } = await setup();
  const created = (await db.doc(`sessions/${roomId}`).get()).get('expiresAt').toMillis();
  expect(created - now).toBe(3 * 60 * 60_000);
  await db.doc(`sessions/${roomId}`).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1) });
  await (await client()).post('/rooms/join', { code: joinCode }).expect(409);
  expect((await p.post(`/rooms/${roomId}/opinion`, { text: '失効後' }).expect(409)).body.error.code).toBe('room_expired');
});
it('期限をサーバー時刻で判定し、再接続でも終了が維持され、新規発言は拒否する', async () => {
  const { h, p, roomId } = await setup(); await enroll(p, roomId);
  await h.post(`/rooms/${roomId}/phase`, { to: 'discussing' }).expect(200);
  const room = await db.doc(`sessions/${roomId}`).get(); expect(room.get('endsAt').toMillis()).toBe(now + 60_000);
  now += 59_999; await p.post(`/rooms/${roomId}/messages`, { text: '期限前' }).expect(200);
  now++; await p.post(`/rooms/${roomId}/check-time`).expect(200);
  expect((await room.ref.get()).get('endReason')).toBe('timeout');
  await p.post(`/rooms/${roomId}/messages`, { text: '期限後' }).expect(409);
  await h.post(`/rooms/${roomId}/finish`).expect(200);
  expect((await room.ref.get()).get('endReason')).toBe('timeout');
  now += 5 * 60_000 + 1;
  await request(app).post(`/rooms/${roomId}/groups/recording?consent=1&durationSec=1`).set(p.headers).set('content-type', 'audio/wav').send(wave()).expect(409);
});
it('期限前と存在しないセッションの検査では終了を書き込まない', async () => {
  const { roomId } = await setup(); await endDiscussion(deps, roomId, 'timeout');
  expect((await db.doc(`sessions/${roomId}`).get()).get('endedAt')).toBeUndefined();
  await endDiscussion(deps, 'missing', 'timeout');
  expect((await db.doc('sessions/missing').get()).exists).toBe(false);
});
it('録音の担当は、最初に引き受けた端末になる。ほかの人は引き受けられず、担当をやめると引き受けられる', async () => {
  const { h, p, roomId, joinCode } = await setup(); await enroll(p, roomId, 'personal', ['青木']);
  const q = await client(); await q.post('/rooms/join', { code: joinCode }).expect(200); await enroll(q, roomId, 'personal', ['佐藤']);
  await h.post(`/rooms/${roomId}/phase`, { to: 'discussing' }).expect(200);
  const group = db.doc(`sessions/${roomId}/groups/1`);
  await h.post(`/rooms/${roomId}/groups/recorder`, { take: true }).expect(403);
  expect((await p.post(`/rooms/${roomId}/groups/recorder`, { take: true }).expect(200)).body).toEqual({ recorderUid: p.uid });
  expect((await group.get()).data()).toMatchObject({ recorderUid: p.uid, recorderName: '青木' });
  await p.post(`/rooms/${roomId}/groups/recorder`, { take: true }).expect(200); // 同じ端末はもう一度押しても同じ
  const taken = await q.post(`/rooms/${roomId}/groups/recorder`, { take: true }).expect(409);
  expect(taken.body.error).toMatchObject({ code: 'recorder_taken', message: '青木さんの端末が録音を担当しています' });
  await q.post(`/rooms/${roomId}/groups/recorder`, { take: false }).expect(200); // 担当でない人がやめても変わらない
  expect((await group.get()).get('recorderUid')).toBe(p.uid);
  await p.post(`/rooms/${roomId}/groups/recorder`, { take: false }).expect(200);
  expect((await group.get()).data()).toMatchObject({ recorderUid: null, recorderName: null });
  await q.post(`/rooms/${roomId}/groups/recorder`, { take: true }).expect(200);
  expect((await group.get()).get('recorderName')).toBe('佐藤');
  // 教員が担当を指定したときも、担当の名前を残す
  await h.post(`/rooms/${roomId}/groups/update`, { group: 1, name: 'グループ1', recorderUid: p.uid }).expect(200);
  expect((await group.get()).data()).toMatchObject({ recorderUid: p.uid, recorderName: '青木' });
  await h.post(`/rooms/${roomId}/finish`).expect(200);
  await p.post(`/rooms/${roomId}/groups/recorder`, { take: false }).expect(409);
});
