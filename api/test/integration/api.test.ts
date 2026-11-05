// エミュレータ上で API の認可・フェーズ・分析の排他・指標を確かめる。
// 実行: リポジトリ直下で npm --prefix firebase run fb -- emulators:exec --project demo-t167 --only auth,firestore "npm --prefix api run test:integration"
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { createApp } from '../../src/app.js';
import { mockGemini } from '../../src/gemini.js';

const PROJECT = 'demo-t167';
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
initializeApp({ projectId: PROJECT });
const db = getFirestore();
let fail = false; let delay = 0; let clock = Date.now();
const app = createApp({ db, auth: getAuth(), gemini: mockGemini({ fail: () => fail, delayMs: () => delay }), now: () => clock });

async function signUp(body: object): Promise<string> {
  const r = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, returnSecureToken: true }),
  });
  return (await r.json()).idToken;
}
const anon = () => signUp({});
let n = 0;
const named = () => signUp({ email: `u${Date.now()}${n++}@example.com`, password: 'password' }); // submit-allow: エミュレータ専用のダミー
const uidOf = (t: string) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).user_id as string;
const api = (token?: string) => ({
  post: (path: string, body: object = {}) => {
    const r = request(app).post(path).send(body);
    return token ? r.set('authorization', `Bearer ${token}`) : r;
  },
});

async function clear() {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
}
async function setupRoom() {
  const mod = await named(); const p1 = await anon(); const p2 = await anon();
  const created = await api(mod).post('/rooms', { title: 'AI利用' });
  const { roomId, joinCode } = created.body;
  await api(p1).post('/rooms/join', { code: joinCode });
  await api(p2).post('/rooms/join', { code: joinCode });
  return { mod, p1, p2, roomId, joinCode };
}
async function toDiscussing(mod: string, roomId: string, opinions: string[], messages: [string, string][]) {
  for (const [i, text] of opinions.entries()) await db.doc(`rooms/${roomId}/privateOpinions/u${i}`).set({ text, updatedAt: FieldValue.serverTimestamp() });
  await api(mod).post(`/rooms/${roomId}/phase`, { to: 'discussing' }).expect(200);
  for (const [uid, text] of messages) await db.collection(`rooms/${roomId}/messages`).add({ uid, text, createdAt: FieldValue.serverTimestamp() });
}

beforeAll(async () => { await clear(); });
beforeEach(() => { fail = false; delay = 0; clock = Date.now(); });

describe('認証と所属', () => {
  it('/health と /healthz は認証なしで実際の Gemini 接続種別を返す', async () => {
    for (const path of ['/health', '/healthz']) {
      await request(app).get(path).expect('Content-Type', /json/).expect(200, { ok: true, gemini: 'mock' });
    }
  });
  it('トークンなしは 401', async () => {
    await api().post('/rooms', { title: 'x' }).expect(401);
  });
  it('匿名ユーザーは部屋を作れない（403）、名前付きユーザーは作れる', async () => {
    await api(await anon()).post('/rooms', { title: 'x' }).expect(403);
    const r = await api(await named()).post('/rooms', { title: 'x' }).expect(201);
    expect(r.body.joinCode).toMatch(/^[A-Z0-9]{6}$/);
  });
  it('参加コードで participant になる。誤ったコードは 404', async () => {
    const { roomId, p1 } = await setupRoom();
    expect((await db.doc(`rooms/${roomId}/members/${uidOf(p1)}`).get()).get('role')).toBe('participant');
    await api(await anon()).post('/rooms/join', { code: 'ZZZZZZ' }).expect(404);
  });
  it('司会者が参加コードを使っても participant に下がらない', async () => {
    const { roomId, mod, joinCode } = await setupRoom();
    await api(mod).post('/rooms/join', { code: joinCode }).expect(200);
    expect((await db.doc(`rooms/${roomId}/members/${uidOf(mod)}`).get()).get('role')).toBe('moderator');
  });
  it('参加者はフェーズを変えられない（403）、メンバー外も 403', async () => {
    const { roomId, p1 } = await setupRoom();
    await api(p1).post(`/rooms/${roomId}/phase`, { to: 'discussing' }).expect(403);
    await api(await anon()).post(`/rooms/${roomId}/phase`, { to: 'discussing' }).expect(403);
  });
  it('フェーズは1つずつしか進めない（409）', async () => {
    const { roomId, mod } = await setupRoom();
    await api(mod).post(`/rooms/${roomId}/phase`, { to: 'consensus' }).expect(409);
  });
});

describe('未検討論点の分析', () => {
  it('議論されていない事前意見だけが提案になり、30秒以内の再実行は 429', async () => {
    const { roomId, mod, p1 } = await setupRoom();
    await toDiscussing(mod, roomId, ['透明性を確保すべき', '費用の負担が心配'], [[uidOf(p1), '費用の負担が心配という声がある']]);
    const r = await api(mod).post(`/rooms/${roomId}/analyze`).expect(200);
    expect(r.body).toMatchObject({ total: 2, suggested: 1 });
    const cov = await db.doc(`rooms/${roomId}/results/coverage`).get();
    expect(cov.get('reflectionRate')).toBe(0.5);
    expect(cov.get('source')).toBe('mock');
    clock += 10_000;
    const again = await api(mod).post(`/rooms/${roomId}/analyze`).expect(429);
    expect(again.body.error.retryAfterSec).toBe(20);
  });
  it('参加者は分析を実行できない（403）、議論フェーズ以外は 409', async () => {
    const { roomId, mod, p1 } = await setupRoom();
    await api(p1).post(`/rooms/${roomId}/analyze`).expect(403);
    await api(mod).post(`/rooms/${roomId}/analyze`).expect(409);
  });
  it('Gemini が失敗したら 503 で、分析状態は failed になる', async () => {
    const { roomId, mod } = await setupRoom();
    await toDiscussing(mod, roomId, ['透明性'], []);
    fail = true;
    await api(mod).post(`/rooms/${roomId}/analyze`).expect(503);
    expect((await db.doc(`rooms/${roomId}`).get()).get('analysis.status')).toBe('failed');
  });
  it('分析中の二重実行は 409', async () => {
    const { roomId, mod } = await setupRoom();
    await toDiscussing(mod, roomId, ['透明性'], []);
    delay = 800;
    const first = api(mod).post(`/rooms/${roomId}/analyze`).then((r) => r);
    await new Promise((r) => setTimeout(r, 300));
    await api(mod).post(`/rooms/${roomId}/analyze`).expect(409);
    expect((await first).status).toBe(200);
  });
  it('遅れて返った古い結果は保存しない', async () => {
    const { roomId, mod } = await setupRoom();
    await toDiscussing(mod, roomId, ['透明性'], []);
    delay = 800;
    const first = api(mod).post(`/rooms/${roomId}/analyze`).then((r) => r);
    await new Promise((r) => setTimeout(r, 300));
    await db.doc(`rooms/${roomId}`).update({ 'analysis.jobId': 'newer-job' });
    const r = await first;
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('stale_result');
    expect((await db.collection(`rooms/${roomId}/insights`).get()).size).toBe(0);
  });
});

describe('提出状況', () => {
  it('司会者は件数だけを受け取り、本文は返らない。参加者は 403', async () => {
    const { roomId, mod, p1 } = await setupRoom();
    await db.doc(`rooms/${roomId}/privateOpinions/${uidOf(p1)}`).set({ text: '非公開の本文', updatedAt: FieldValue.serverTimestamp() });
    const r = await api(mod).post(`/rooms/${roomId}/progress`).expect(200);
    expect(r.body).toEqual({ participants: 2, opinions: 1, statements: 0, byGroup: [{ group: 1, participants: 2, opinions: 1, statements: 0 }] });
    expect(JSON.stringify(r.body)).not.toContain('非公開の本文');
    await api(p1).post(`/rooms/${roomId}/progress`).expect(403);
  });
});

describe('クラス内のグループ', () => {
  it('参加した順にグループへ割り当て、提出状況をグループごとに返す', async () => {
    const mod = await named();
    const { roomId, joinCode } = (await api(mod).post('/rooms', { title: 'グループ', groups: 2 }).expect(201)).body;
    const ps = [await anon(), await anon(), await anon()];
    for (const p of ps) await api(p).post('/rooms/join', { code: joinCode }).expect(200);
    await api(ps[0]).post('/rooms/join', { code: joinCode }).expect(200); // 2回目の参加でグループは変わらない
    const groups = await Promise.all(ps.map(async (p) => (await db.doc(`rooms/${roomId}/members/${uidOf(p)}`).get()).get('group')));
    expect(groups).toEqual([1, 2, 1]);
    await db.doc(`rooms/${roomId}/privateOpinions/${uidOf(ps[1])}`).set({ text: 'x', updatedAt: FieldValue.serverTimestamp() });
    const r = await api(mod).post(`/rooms/${roomId}/progress`).expect(200);
    expect(r.body.byGroup).toEqual([
      { group: 1, participants: 2, opinions: 0, statements: 0 },
      { group: 2, participants: 1, opinions: 1, statements: 0 },
    ]);
  });
  it('グループの数は1〜12', async () => {
    const mod = await named();
    await api(mod).post('/rooms', { title: 'x', groups: 0 }).expect(400);
    await api(mod).post('/rooms', { title: 'x', groups: 13 }).expect(400);
  });
});

describe('グループごとの進行', () => {
  it('生徒がグループの議論を終え、全員の一文がそろうとグループの結果が出る', async () => {
    const { roomId, mod, p1, p2 } = await setupRoom();
    const say = (t: string, text: string) => api(t).post(`/rooms/${roomId}/statement`, { text, agreement: 4 });
    await api(p1).post(`/rooms/${roomId}/groups/end`).expect(409); // まだ議論中ではない
    await api(mod).post(`/rooms/${roomId}/phase`, { to: 'discussing' }).expect(200);
    await say(p1, '申告すれば利用可').expect(409); // 議論を終える前は書けない
    await api(mod).post(`/rooms/${roomId}/groups/end`).expect(403); // 先生は生徒の代わりに終えられない
    await api(p1).post(`/rooms/${roomId}/groups/end`).expect(200);
    await api(p2).post(`/rooms/${roomId}/groups/end`).expect(200); // 2回目は何もしない
    expect((await db.doc(`rooms/${roomId}`).get()).get('groupState')['1']).toMatchObject({ status: 'consensus', total: 2, submitted: 0 });

    const r1 = await say(p1, '申告すれば利用可').expect(200);
    expect(r1.body).toMatchObject({ group: 1, ready: false, analyzed: false, submitted: 1, total: 2 });
    expect((await db.doc(`rooms/${roomId}/results/group-1`).get()).exists).toBe(false);
    const r2 = await say(p2, '教員の許可があれば利用可').expect(200);
    expect(r2.body).toMatchObject({ ready: true, analyzed: true, submitted: 2, total: 2 });
    const result = (await db.doc(`rooms/${roomId}/results/group-1`).get()).data();
    expect(result).toMatchObject({ group: 1, respondents: 2, alignmentRate: 0.5, source: 'mock' });
    expect(result?.clusters).toHaveLength(2);
    expect((await db.doc(`rooms/${roomId}`).get()).get('groupState')['1'].status).toBe('done');
  });
  it('先生はそろっていなくても、今ある回答でグループの結果を出せる。生徒はそろうまで出せない', async () => {
    const { roomId, mod, p1 } = await setupRoom();
    await api(mod).post(`/rooms/${roomId}/phase`, { to: 'discussing' }).expect(200);
    await api(p1).post(`/rooms/${roomId}/groups/end`).expect(200);
    await api(p1).post(`/rooms/${roomId}/statement`, { text: '費用が心配', agreement: 3 }).expect(200);
    expect((await api(p1).post(`/rooms/${roomId}/groups/analyze`).expect(200)).body.analyzed).toBe(false);
    expect((await api(mod).post(`/rooms/${roomId}/groups/analyze`, { group: 1 }).expect(200)).body.analyzed).toBe(true);
  });
  it('Gemini が失敗しても一文は保存され、あとで出し直せる', async () => {
    const { roomId, mod, p1, p2 } = await setupRoom();
    await api(mod).post(`/rooms/${roomId}/phase`, { to: 'discussing' }).expect(200);
    await api(p1).post(`/rooms/${roomId}/groups/end`).expect(200);
    await api(p1).post(`/rooms/${roomId}/statement`, { text: 'a', agreement: 3 }).expect(200);
    fail = true;
    expect((await api(p2).post(`/rooms/${roomId}/statement`, { text: 'b', agreement: 3 }).expect(200)).body).toMatchObject({ analyzed: false, error: 'gemini_unavailable' });
    expect((await db.doc(`rooms/${roomId}/consensusStatements/${uidOf(p2)}`).get()).exists).toBe(true);
    await api(p2).post(`/rooms/${roomId}/groups/analyze`).expect(503);
    fail = false;
    expect((await api(p2).post(`/rooms/${roomId}/groups/analyze`).expect(200)).body.analyzed).toBe(true);
  });
});

describe('承認と合意の検証', () => {
  it('参加者は承認できず、司会者は承認でき、2回目は 409', async () => {
    const { roomId, mod, p1 } = await setupRoom();
    await toDiscussing(mod, roomId, ['透明性を確保すべき'], []);
    await api(mod).post(`/rooms/${roomId}/analyze`).expect(200);
    const id = (await db.collection(`rooms/${roomId}/insights`).get()).docs[0].id;
    await api(p1).post(`/rooms/${roomId}/insights/${id}/approve`).expect(403);
    await api(mod).post(`/rooms/${roomId}/insights/${id}/approve`).expect(200);
    await api(mod).post(`/rooms/${roomId}/insights/${id}/approve`).expect(409);
  });
  it('合意の一文のずれと4つの指標を計算する', async () => {
    const { roomId, mod, p1, p2 } = await setupRoom();
    await toDiscussing(mod, roomId, ['透明性を確保すべき', '費用が心配'], [[uidOf(p1), '費用が心配です'], [uidOf(p1), 'そうですね']]);
    await api(mod).post(`/rooms/${roomId}/analyze`).expect(200);
    const id = (await db.collection(`rooms/${roomId}/insights`).get()).docs[0].id;
    await api(mod).post(`/rooms/${roomId}/insights/${id}/approve`).expect(200);
    await db.collection(`rooms/${roomId}/messages`).add({ uid: uidOf(p2), text: '透明性を確保すべきだと思う', createdAt: FieldValue.serverTimestamp() });
    await api(mod).post(`/rooms/${roomId}/phase`, { to: 'consensus' }).expect(200);
    await db.doc(`rooms/${roomId}/consensusStatements/${uidOf(p1)}`).set({ text: '申告すれば利用可', agreement: 4, updatedAt: FieldValue.serverTimestamp() });
    await db.doc(`rooms/${roomId}/consensusStatements/${uidOf(p2)}`).set({ text: '教員の許可があれば利用可', agreement: 5, updatedAt: FieldValue.serverTimestamp() });
    const r = await api(mod).post(`/rooms/${roomId}/consensus/analyze`).expect(200);
    expect(r.body.groups).toHaveLength(2);
    expect(r.body.metrics).toMatchObject({ reflectionRate: 0.5, alignmentRate: 0.5, interventionEffectiveness: 1 });
    expect(r.body.metrics.participationFairness).toBeGreaterThan(0);
    expect(r.body.source).toBe('mock');
    expect(r.body.byGroup).toEqual([{ group: 1, respondents: 2, alignmentRate: 0.5, clusters: [
      { label: expect.any(String), count: 1 }, { label: expect.any(String), count: 1 },
    ] }]);
  });
});
