import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { emulatorGoogleUser } from '../../../firebase/emulator-auth.mjs';
import { createApp } from '../../src/app.js';
import { mockGemini } from '../../src/gemini.js';
import { wave } from '../fixtures/audio.js';
const projectId = process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId?.startsWith('demo-') || !/^(localhost|127\.0\.0\.1):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) throw new Error('専用エミュレータが必要です');
initializeApp({ projectId });
const db = getFirestore(), auth = getAuth(), app = createApp({ db, auth, gemini: mockGemini() });
async function client() {
  const account = await emulatorGoogleUser('student', `roles-${randomUUID()}`);
  const login = await request(app).post('/sessions').set('authorization', `Bearer ${account.idToken}`).send({ deviceLabel: '架空の端末', deviceType: 'pc' }).expect(201);
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  return { uid: account.localId, loginId: login.body.session.sessionId, post: (path: string, body = {}) => request(app).post(path).set('authorization', `Bearer ${account.idToken}`).set('cookie', cookie).send(body), get: (path: string) => request(app).get(path).set('authorization', `Bearer ${account.idToken}`).set('cookie', cookie), account, cookie };
}
async function room(c: Awaited<ReturnType<typeof client>>, patch = {}) {
  return (await c.post('/rooms', { title: '架空のセッション', theme: 'テーマ', minutes: 20, groups: 2, ...patch }).expect(201)).body as { roomId: string; joinCode: string };
}
describe('MVPのセッション単位Host/Participant', () => {
  it('claimもClassroomも不要で、作成とHost付与・グループを一括保存する', async () => {
    const c = await client(), r = await room(c);
    const snap = await db.doc(`sessions/${r.roomId}`).get();
    expect(snap.data()).toMatchObject({ title: '架空のセッション', theme: 'テーマ', minutes: 20, resultsPublished: false });
    expect((await snap.ref.collection('members').doc(c.uid).get()).data()).toMatchObject({ uid: c.uid, role: 'host', groupId: null, status: 'active' });
    expect((await snap.ref.collection('groups').get()).size).toBe(2);
    expect((await c.get('/sessions/current').expect(200)).body.policy.maxConcurrentSessions).toBe(1);
    expect((await db.doc(`users/${c.uid}/sessions/${c.loginId}`).get()).get('role')).toBeUndefined();
    expect((await c.get('/discussions').expect(200)).body.sessions).toContainEqual(expect.objectContaining({ sessionId: r.roomId, role: 'host' }));
  });
  it('同じ利用者がAでHost、BでParticipantとなり、ログインセッションを変更しない', async () => {
    const a = await client(), b = await client(), ra = await room(a), rb = await room(b);
    await a.post('/rooms/join', { code: rb.joinCode }).expect(200);
    await a.post(`/rooms/${ra.roomId}/settings`, { theme: '変更したテーマ' }).expect(200);
    await a.post(`/rooms/${rb.roomId}/settings`, { title: '不正' }).expect(403);
    const list = (await a.get('/discussions').expect(200)).body.sessions;
    expect(list).toContainEqual(expect.objectContaining({ sessionId: ra.roomId, role: 'host' }));
    expect(list).toContainEqual(expect.objectContaining({ sessionId: rb.roomId, role: 'participant' }));
    expect((await a.get('/sessions/current').expect(200)).body.session.sessionId).toBe(a.loginId);
    await a.post('/rooms/join', { code: ra.joinCode }).expect(200);
    expect((await a.get(`/rooms/${ra.roomId}/me`).expect(200)).body.role).toBe('host');
  });
  it('Participant・未参加ユーザーはHost用APIと別セッションの結果へアクセスできない', async () => {
    const h = await client(), p = await client(), outsider = await client(), r = await room(h);
    await p.post('/rooms/join', { code: r.joinCode, role: 'host' }).expect(200);
    for (const c of [p, outsider]) {
      for (const [path, body] of [
        ['settings', { title: '不正' }], ['groups/create', { name: '不正' }], ['groups/update', { group: 1, name: '不正' }],
        ['groups/delete', { group: 2 }], ['groups/assign', { uid: p.uid, group: 1 }], ['phase', { to: 'discussing' }],
        ['consensus/analyze', {}], ['analyze', {}],
      ] as const) await c.post(`/rooms/${r.roomId}/${path}`, body).expect(403);
      await c.get(`/rooms/${r.roomId}/results/summary`).expect(403);
    }
    await outsider.get(`/rooms/${r.roomId}/groups`).expect(403);
    await p.post(`/rooms/${r.roomId}/settings`, { role: 'host' }).expect(403);
    expect((await db.doc(`sessions/${r.roomId}/members/${p.uid}`).get()).get('role')).toBe('participant');
  });
  it('所属グループの結果だけ、公開中のみ閲覧でき、公開停止も即時に反映する', async () => {
    const h = await client(), p = await client(), r = await room(h);
    await p.post('/rooms/join', { code: r.joinCode }).expect(200);
    await p.post(`/rooms/${r.roomId}/groups/choose`, { group: 1 }).expect(200);
    for (const id of ['group-1', 'flow-g1', 'group-2', 'summary']) await db.doc(`sessions/${r.roomId}/results/${id}`).set({ label: id });
    await h.get(`/rooms/${r.roomId}/results/summary`).expect(200);
    await p.get(`/rooms/${r.roomId}/results/group-1`).expect(403);
    await h.post(`/rooms/${r.roomId}/settings`, { resultsPublished: true }).expect(200);
    await p.get(`/rooms/${r.roomId}/results/group-1`).expect(200);
    await p.get(`/rooms/${r.roomId}/results/flow-g1`).expect(200);
    await p.get(`/rooms/${r.roomId}/results/group-2`).expect(403);
    await p.get(`/rooms/${r.roomId}/results/summary`).expect(403);
    await h.get(`/rooms/${r.roomId}/results/missing`).expect(404);
    await h.post(`/rooms/${r.roomId}/settings`, { resultsPublished: false }).expect(200);
    await p.get(`/rooms/${r.roomId}/results/group-1`).expect(403);
    const other = await room(h); await p.get(`/rooms/${other.roomId}/results/group-1`).expect(403);
  });
  it('Hostが所属・名前・録音担当を管理し、未割当の参加者は自分で昇格・所属変更できない', async () => {
    const h = await client(), p = await client(), r = await room(h, { groupSelection: 'host' });
    await p.post('/rooms/join', { code: r.joinCode }).expect(200);
    expect((await p.get(`/rooms/${r.roomId}/me`).expect(200)).body.group).toBeNull();
    await p.post(`/rooms/${r.roomId}/groups/choose`, { group: 1 }).expect(403);
    await h.post(`/rooms/${r.roomId}/groups/assign`, { uid: h.uid, group: 1 }).expect(400);
    await h.post(`/rooms/${r.roomId}/groups/assign`, { uid: p.uid, group: 3 }).expect(400);
    await h.post(`/rooms/${r.roomId}/groups/assign`, { uid: p.uid, group: 1 }).expect(200);
    await h.post(`/rooms/${r.roomId}/groups/update`, { group: 2, name: '別グループ', recorderUid: p.uid }).expect(400);
    await h.post(`/rooms/${r.roomId}/groups/update`, { group: 1, name: '検討班', recorderUid: p.uid }).expect(200);
    await h.post(`/rooms/${r.roomId}/groups/update`, { group: 3, name: '存在しない班' }).expect(404);
    expect((await p.get(`/rooms/${r.roomId}/groups`).expect(200)).body.groups).toEqual([expect.objectContaining({ groupId: '1', name: '検討班', recorderUid: p.uid })]);
    await h.post(`/rooms/${r.roomId}/groups/create`, { name: '追加班' }).expect(201);
    await h.post(`/rooms/${r.roomId}/groups/delete`, { group: 2 }).expect(409);
    await h.post(`/rooms/${r.roomId}/groups/delete`, { group: 3 }).expect(200);
    await h.post(`/rooms/${r.roomId}/groups/delete`, { group: 2 }).expect(200);
    await h.post(`/rooms/${r.roomId}/groups/delete`, { group: 1 }).expect(409);
    await h.post(`/rooms/${r.roomId}/settings`, { role: 'host' }).expect(400);
    await h.post(`/rooms/${r.roomId}/phase`, { to: 'discussing' }).expect(200);
    await h.post(`/rooms/${r.roomId}/groups/create`, { name: '開始後' }).expect(409);
    await h.post(`/rooms/${r.roomId}/phase`, { to: 'consensus' }).expect(200);
    await h.post(`/rooms/${r.roomId}/phase`, { to: 'closed' }).expect(200);
    await h.post(`/rooms/${r.roomId}/settings`, { title: '終了後' }).expect(409);
    await h.post(`/rooms/${r.roomId}/settings`, { resultsPublished: true }).expect(200);
  });
  it('Hostになっても学校管理者APIは操作できず、新端末のログインで旧端末は失効する', async () => {
    const c = await client(), r = await room(c);
    await c.get('/schools/school/security-policy').expect(403);
    const replacement = await request(app).post('/sessions').set('authorization', `Bearer ${c.account.idToken}`).send({ deviceLabel: '新端末', deviceType: 'phone' }).expect(201);
    await c.get('/sessions/current').expect(401);
    await c.post(`/rooms/${r.roomId}/settings`, { title: '失効済み' }).expect(401);
    await request(app).post(`/rooms/${r.roomId}/settings`).set('authorization', `Bearer ${c.account.idToken}`).set('cookie', replacement.headers['set-cookie'][0].split(';')[0]).send({ theme: '同じHost権限を維持' }).expect(200);
  });
  it('事前意見がそろってもHostの開始前に議論は始まらない', async () => {
    const h = await client(), p = await client(), r = await room(h, { groups: 1 });
    await p.post('/rooms/join', { code: r.joinCode }).expect(200);
    await p.post(`/rooms/${r.roomId}/opinion`, { text: '開始前の意見' }).expect(200);
    expect((await db.doc(`sessions/${r.roomId}`).get()).get('groupState.1.status')).toBeUndefined();
    await p.post(`/rooms/${r.roomId}/groups/end`).expect(409);
    await h.post(`/rooms/${r.roomId}/phase`, { to: 'discussing' }).expect(200);
    expect((await db.doc(`sessions/${r.roomId}`).get()).get('groupState.1.status')).toBe('discussing');
  });
  it('指定の録音担当以外からの音声アップロードを拒否する', async () => {
    const h = await client(), p = await client(), q = await client(), r = await room(h, { groups: 1 });
    for (const c of [p, q]) await c.post('/rooms/join', { code: r.joinCode }).expect(200);
    await h.post(`/rooms/${r.roomId}/groups/update`, { group: 1, name: '録音班', recorderUid: p.uid }).expect(200);
    await h.post(`/rooms/${r.roomId}/phase`, { to: 'discussing' }).expect(200);
    for (const c of [p, q]) await c.post(`/rooms/${r.roomId}/opinion`, { text: '架空の意見' }).expect(200);
    await request(app).post(`/rooms/${r.roomId}/groups/recording?consent=1&durationSec=1`).set('authorization', `Bearer ${q.account.idToken}`).set('cookie', q.cookie).set('content-type', 'audio/wav').send(wave()).expect(403);
  });
});
