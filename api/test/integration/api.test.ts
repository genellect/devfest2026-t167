// エミュレータ上で API の認可・フェーズ・分析の排他・指標を確かめる。
// 実行: リポジトリ直下で npm --prefix firebase run fb -- emulators:exec --project demo-t167 --only auth,firestore "npm --prefix api run test:integration"
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { wave } from '../fixtures/audio.js';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { createApp } from '../../src/app.js';
import { emulatorGoogleUser } from '../../../firebase/emulator-auth.mjs';
import { mockGemini } from '../../src/gemini.js';

const PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? 'demo-t167';
if (!PROJECT.startsWith('demo-')) throw new Error('試験はデモ用プロジェクトだけで実行できます');
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key] ?? '')) throw new Error('試験には専用のローカルエミュレータを指定してください');
}
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
const anonymous = () => signUp({});
const cookies = new Map<string, string>();
async function withSession(token: string) {
  const response = await request(app).post('/sessions').set('authorization', `Bearer ${token}`).send({ deviceLabel: 'test', deviceType: 'pc' }).expect(201);
  cookies.set(token, response.headers['set-cookie'][0].split(';')[0]); return token;
}
const anon = async () => withSession((await emulatorGoogleUser('student', `s-${Date.now()}-${n++}`)).idToken);
let n = 0;
const named = async () => withSession((await emulatorGoogleUser('teacher', `t-${Date.now()}-${n++}`)).idToken);
const uidOf = (t: string) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).user_id as string;
const api = (token?: string) => ({
  post: (path: string, body: object = {}) => {
    const r = request(app).post(path).send(body);
    return token ? r.set('authorization', `Bearer ${token}`).set('cookie', cookies.get(token) ?? '') : r;
  },
});

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
function blocked(method: 'findPoints' | 'compare') {
  const entered = gate(), release = gate(), base = mockGemini();
  const gemini = { ...base };
  if (method === 'findPoints') gemini.findPoints = async (...args) => { entered.resolve(); await release.promise; return base.findPoints(...args); };
  else gemini.compare = async (...args) => { entered.resolve(); await release.promise; return base.compare(...args); };
  const target = createApp({ db, auth: getAuth(), gemini, now: () => clock });
  const post = (token: string, path: string, body: object = {}) => request(target).post(path).set('authorization', `Bearer ${token}`).set('cookie', cookies.get(token) ?? '').send(body);
  return { entered, release, post };
}

async function clear() {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
}
async function setupRoom(start = false) {
  const mod = await named(); const p1 = await anon(); const p2 = await anon();
  const created = await api(mod).post('/rooms', { title: 'AI利用' });
  const { roomId, joinCode } = created.body;
  await api(p1).post('/rooms/join', { code: joinCode });
  await api(p2).post('/rooms/join', { code: joinCode });
  if (start) await api(mod).post(`/rooms/${roomId}/phase`, { to: 'discussing' }).expect(200);
  return { mod, p1, p2, roomId, joinCode };
}
async function toDiscussing(mod: string, roomId: string, opinions: string[], messages: [string, string][]) {
  for (const [i, text] of opinions.entries()) await db.doc(`sessions/${roomId}/privateOpinions/u${i}`).set({ text, updatedAt: FieldValue.serverTimestamp() });
  await api(mod).post(`/rooms/${roomId}/phase`, { to: 'discussing' }).expect(200);
  for (const [uid, text] of messages) await db.collection(`sessions/${roomId}/messages`).add({ uid, text, createdAt: FieldValue.serverTimestamp() });
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
  it('匿名は拒否し、教師claimなしを含む全Google利用者がHostになれる', async () => {
    await api(await anonymous()).post('/rooms', { title: 'x' }).expect(403);
    await api(await anon()).post('/rooms', { title: 'x' }).expect(201);
    const r = await api(await named()).post('/rooms', { title: 'x' }).expect(201);
    expect(r.body.joinCode).toMatch(/^[A-Z0-9]{6}$/);
  });
  it('参加コードで participant になる。誤ったコードは 404', async () => {
    const { roomId, p1 } = await setupRoom();
    expect((await db.doc(`sessions/${roomId}/members/${uidOf(p1)}`).get()).get('role')).toBe('participant');
    await api(await anon()).post('/rooms/join', { code: 'ZZZZZZ' }).expect(404);
  });
  it('司会者が参加コードを使っても participant に下がらない', async () => {
    const { roomId, mod, joinCode } = await setupRoom();
    await api(mod).post('/rooms/join', { code: joinCode }).expect(200);
    expect((await db.doc(`sessions/${roomId}/members/${uidOf(mod)}`).get()).get('role')).toBe('host');
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
    const cov = await db.doc(`sessions/${roomId}/results/coverage`).get();
    expect(cov.get('reflectionRate')).toBe(0.5);
    expect(cov.get('source')).toBe('mock');
    clock += 10_000;
    const again = await api(mod).post(`/rooms/${roomId}/analyze`).expect(429);
    expect(again.body.error.retryAfterSec).toBe(20);
  });
  it('参加者は分析を実行できない（403）、授業が終わった部屋では 409', async () => {
    const { roomId, mod, p1 } = await setupRoom();
    await api(p1).post(`/rooms/${roomId}/analyze`).expect(403);
    for (const to of ['discussing', 'consensus']) await api(mod).post(`/rooms/${roomId}/phase`, { to }).expect(200);
    await api(mod).post(`/rooms/${roomId}/analyze`).expect(409);
  });
  it('Gemini が失敗したら 503 で、分析状態は failed になる', async () => {
    const { roomId, mod } = await setupRoom();
    await toDiscussing(mod, roomId, ['透明性'], []);
    fail = true;
    await api(mod).post(`/rooms/${roomId}/analyze`).expect(503);
    expect((await db.doc(`sessions/${roomId}`).get()).get('analysis.status')).toBe('failed');
  });
  it('分析中の二重実行は 409', async () => {
    const { roomId, mod } = await setupRoom();
    await toDiscussing(mod, roomId, ['透明性'], []);
    const { entered, release, post } = blocked('findPoints');
    const first = post(mod, `/rooms/${roomId}/analyze`).then((r) => r);
    await entered.promise;
    try { await post(mod, `/rooms/${roomId}/analyze`).expect(409); }
    finally { release.resolve(); }
    expect((await first).status).toBe(200);
  });
  it('遅れて返った古い結果は保存しない', async () => {
    const { roomId, mod } = await setupRoom();
    await toDiscussing(mod, roomId, ['透明性'], []);
    const { entered, release, post } = blocked('findPoints');
    const first = post(mod, `/rooms/${roomId}/analyze`).then((r) => r);
    await entered.promise;
    try { await db.doc(`sessions/${roomId}`).update({ 'analysis.jobId': 'newer-job' }); }
    finally { release.resolve(); }
    const r = await first;
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('stale_result');
    expect((await db.collection(`sessions/${roomId}/insights`).get()).size).toBe(0);
  });
});

describe('提出状況', () => {
  it('司会者は件数だけを受け取り、本文は返らない。参加者は 403', async () => {
    const { roomId, mod, p1 } = await setupRoom();
    await db.doc(`sessions/${roomId}/privateOpinions/${uidOf(p1)}`).set({ text: '非公開の本文', updatedAt: FieldValue.serverTimestamp() });
    const r = await api(mod).post(`/rooms/${roomId}/progress`).expect(200);
    expect(r.body).toEqual({ participants: 2, opinions: 1, statements: 0, byGroup: [{ group: 1, participants: 2, opinions: 1, statements: 0 }] });
    expect(JSON.stringify(r.body)).not.toContain('非公開の本文');
    await api(p1).post(`/rooms/${roomId}/progress`).expect(403);
  });
});

describe('クラス内のグループ', () => {
  async function classRoom(groups: number, n: number) {
    const mod = await named();
    const { roomId, joinCode } = (await api(mod).post('/rooms', { title: 'グループ', groups }).expect(201)).body;
    const ps: string[] = [];
    for (let i = 0; i < n; i++) { const p = await anon(); await api(p).post('/rooms/join', { code: joinCode }).expect(200); ps.push(p); }
    await api(mod).post(`/rooms/${roomId}/phase`, { to: 'discussing' }).expect(200);
    return { mod, roomId, ps };
  }
  const state = async (roomId: string, g: number) => (await db.doc(`sessions/${roomId}`).get()).get('groupState')?.[String(g)];

  it('グループが複数なら参加後に生徒が選ぶ。1つなら自動でグループ1', async () => {
    const one = await classRoom(1, 1);
    expect((await db.doc(`sessions/${one.roomId}/members/${uidOf(one.ps[0])}`).get()).get('group')).toBe(1);
    const { roomId, ps, mod } = await classRoom(2, 2);
    expect((await db.doc(`sessions/${roomId}/members/${uidOf(ps[0])}`).get()).get('group')).toBeUndefined();
    await api(ps[0]).post(`/rooms/${roomId}/opinion`, { text: 'x' }).expect(409); // グループを選ぶ前は書けない
    await api(ps[0]).post(`/rooms/${roomId}/groups/choose`, { group: 3 }).expect(400);
    await api(mod).post(`/rooms/${roomId}/groups/choose`, { group: 1 }).expect(403);
    await api(ps[0]).post(`/rooms/${roomId}/groups/choose`, { group: 1 }).expect(200);
    await api(ps[1]).post(`/rooms/${roomId}/groups/choose`, { group: 2 }).expect(200);
    await api(ps[1]).post(`/rooms/${roomId}/groups/choose`, { group: 1 }).expect(200); // 始まる前なら移れる
    expect(await state(roomId, 1)).toMatchObject({ total: 2, opinions: 0 });
    expect(await state(roomId, 2)).toMatchObject({ total: 0 });
  });

  it('グループ全員の事前意見がそろうと議論が始まり、始まったグループには入れない', async () => {
    const { roomId, ps, mod } = await classRoom(2, 3);
    for (const p of ps.slice(0, 2)) await api(p).post(`/rooms/${roomId}/groups/choose`, { group: 1 }).expect(200);
    const r1 = await api(ps[0]).post(`/rooms/${roomId}/opinion`, { text: '費用が心配' }).expect(200);
    expect(r1.body).toMatchObject({ total: 2, opinions: 1, started: false });
    expect((await state(roomId, 1)).status).toBeUndefined();
    await api(ps[1]).post(`/rooms/${roomId}/opinion`, { text: '透明性が大事' }).expect(200);
    expect(await state(roomId, 1)).toMatchObject({ status: 'discussing', total: 2, opinions: 2 });
    await api(ps[0]).post(`/rooms/${roomId}/opinion`, { text: '書き直し' }).expect(409); // 始まったら書き直せない
    await api(ps[2]).post(`/rooms/${roomId}/groups/choose`, { group: 1 }).expect(409);
    await api(ps[0]).post(`/rooms/${roomId}/groups/choose`, { group: 2 }).expect(409);
    // 提出数は件数だけで、本文は返らない
    const pr = await api(mod).post(`/rooms/${roomId}/progress`).expect(200);
    expect(pr.body.byGroup).toEqual([
      { group: 1, participants: 2, opinions: 2, statements: 0 },
      { group: 2, participants: 0, opinions: 0, statements: 0 },
    ]);
    expect(JSON.stringify(pr.body)).not.toContain('費用');
  });

  it('先生は今いるメンバーで議論を始められる', async () => {
    const { roomId, ps, mod } = await classRoom(2, 2);
    for (const p of ps) await api(p).post(`/rooms/${roomId}/groups/choose`, { group: 2 }).expect(200);
    await api(ps[0]).post(`/rooms/${roomId}/opinion`, { text: 'a' }).expect(200);
    await api(ps[0]).post(`/rooms/${roomId}/groups/start`, { group: 2 }).expect(403);
    await api(mod).post(`/rooms/${roomId}/groups/start`, { group: 2 }).expect(200);
    expect((await state(roomId, 2)).status).toBe('discussing');
  });

  it('グループの数は1〜12', async () => {
    const mod = await named();
    await api(mod).post('/rooms', { title: 'x', groups: 0 }).expect(400);
    await api(mod).post('/rooms', { title: 'x', groups: 13 }).expect(400);
  });
});

describe('グループごとの進行', () => {
  async function discussing() {
    const r = await setupRoom(true);
    for (const p of [r.p1, r.p2]) await api(p).post(`/rooms/${r.roomId}/opinion`, { text: '意見' }).expect(200);
    return r;
  }
  it('生徒がグループの議論を終え、全員の一文がそろうとグループの結果が出る', async () => {
    const { roomId, mod, p1, p2 } = await setupRoom(true);
    const say = (t: string, text: string) => api(t).post(`/rooms/${roomId}/statement`, { text, agreement: 4 });
    await api(p1).post(`/rooms/${roomId}/opinion`, { text: '意見' }).expect(200);
    await api(p1).post(`/rooms/${roomId}/groups/end`).expect(409); // まだ議論が始まっていない
    await api(p2).post(`/rooms/${roomId}/opinion`, { text: '意見' }).expect(200);
    await say(p1, '申告すれば利用可').expect(409); // 議論を終える前は書けない
    await api(mod).post(`/rooms/${roomId}/groups/end`).expect(403); // 先生は生徒の代わりに終えられない
    await api(p1).post(`/rooms/${roomId}/groups/end`).expect(200);
    await api(p2).post(`/rooms/${roomId}/groups/end`).expect(200); // 2回目は何もしない
    expect((await db.doc(`sessions/${roomId}`).get()).get('groupState')['1']).toMatchObject({ status: 'consensus', total: 2, submitted: 0 });

    const r1 = await say(p1, '申告すれば利用可').expect(200);
    expect(r1.body).toMatchObject({ group: 1, ready: false, analyzed: false, submitted: 1, total: 2 });
    expect((await db.doc(`sessions/${roomId}/results/group-1`).get()).exists).toBe(false);
    const r2 = await say(p2, '教員の許可があれば利用可').expect(200);
    expect(r2.body).toMatchObject({ ready: true, analyzed: true, submitted: 2, total: 2 });
    const result = (await db.doc(`sessions/${roomId}/results/group-1`).get()).data();
    expect(result).toMatchObject({ group: 1, respondents: 2, alignmentRate: 0.5, source: 'mock' });
    expect(result?.clusters).toHaveLength(2);
    expect((await db.doc(`sessions/${roomId}`).get()).get('groupState')['1'].status).toBe('done');
  });
  it('先生はそろっていなくても、今ある回答でグループの結果を出せる。生徒はそろうまで出せない', async () => {
    const { roomId, mod, p1 } = await discussing();
    await api(p1).post(`/rooms/${roomId}/groups/end`).expect(200);
    await api(p1).post(`/rooms/${roomId}/statement`, { text: '費用が心配', agreement: 3 }).expect(200);
    expect((await api(p1).post(`/rooms/${roomId}/groups/analyze`).expect(200)).body.analyzed).toBe(false);
    expect((await api(mod).post(`/rooms/${roomId}/groups/analyze`, { group: 1 }).expect(200)).body.analyzed).toBe(true);
  });
  it('Gemini が失敗しても一文は保存され、あとで出し直せる', async () => {
    const { roomId, p1, p2 } = await discussing();
    await api(p1).post(`/rooms/${roomId}/groups/end`).expect(200);
    await api(p1).post(`/rooms/${roomId}/statement`, { text: 'a', agreement: 3 }).expect(200);
    fail = true;
    expect((await api(p2).post(`/rooms/${roomId}/statement`, { text: 'b', agreement: 3 }).expect(200)).body).toMatchObject({ analyzed: false, error: 'gemini_unavailable' });
    expect((await db.doc(`sessions/${roomId}/consensusStatements/${uidOf(p2)}`).get()).exists).toBe(true);
    await api(p2).post(`/rooms/${roomId}/groups/analyze`).expect(429); // 前の分析から30秒たっていない
    clock += 31_000;
    await api(p2).post(`/rooms/${roomId}/groups/analyze`).expect(503);
    fail = false;
    clock += 31_000;
    expect((await api(p2).post(`/rooms/${roomId}/groups/analyze`).expect(200)).body.analyzed).toBe(true);
  });
  it('結果が出たグループは、生徒の操作では分析し直さない。先生の出し直しは30秒あける', async () => {
    const { roomId, mod, p1, p2 } = await discussing();
    await api(p1).post(`/rooms/${roomId}/groups/end`).expect(200);
    await api(p1).post(`/rooms/${roomId}/statement`, { text: 'a', agreement: 3 }).expect(200);
    await api(p2).post(`/rooms/${roomId}/statement`, { text: "b", agreement: 3 }).expect(200);
    const first = (await db.doc(`sessions/${roomId}/results/group-1`).get()).get('jobId');
    clock += 31_000;
    // 一文の送り直しと出し直しでは、Gemini を呼ばない
    await api(p2).post(`/rooms/${roomId}/statement`, { text: "変更", agreement: 3 }).expect(409);
    expect((await api(p2).post(`/rooms/${roomId}/groups/analyze`).expect(200)).body).toMatchObject({ analyzed: false, skipped: 'done' });
    expect((await db.doc(`sessions/${roomId}/results/group-1`).get()).get('jobId')).toBe(first);
    // 先生は出し直せるが、続けては出せない
    expect((await api(mod).post(`/rooms/${roomId}/groups/analyze`, { group: 1 }).expect(200)).body.analyzed).toBe(true);
    await api(mod).post(`/rooms/${roomId}/groups/analyze`, { group: 1 }).expect(429);
  });
  it('同時に分析が始まっても、Gemini を呼ぶのは1回だけ', async () => {
    const { roomId, mod, p1, p2 } = await discussing();
    await api(p1).post(`/rooms/${roomId}/groups/end`).expect(200);
    await api(p1).post(`/rooms/${roomId}/statement`, { text: 'a', agreement: 3 }).expect(200);
    const { entered, release, post } = blocked('compare');
    const pending = post(p2, `/rooms/${roomId}/statement`, { text: 'b', agreement: 3 }).then((r) => r);
    await entered.promise;
    let manual;
    try { manual = await post(mod, `/rooms/${roomId}/groups/analyze`, { group: 1 }); }
    finally { release.resolve(); }
    const auto = await pending;
    expect(auto.body.analyzed).toBe(true);
    expect(manual!.status).toBe(200);
    expect(manual!.body).toMatchObject({ analyzed: false, skipped: 'running' });
  });
  it('存在しないグループ番号は受け付けない', async () => {
    const { roomId, mod } = await setupRoom(true); // グループは1つ
    await api(mod).post(`/rooms/${roomId}/groups/start`, { group: 2 }).expect(400);
    await api(mod).post(`/rooms/${roomId}/groups/analyze`, { group: 2 }).expect(400);
  });
});

describe('録音の分析', () => {
  const upload = (token: string, roomId: string, q = 'consent=1&durationSec=600', type = 'audio/wav', bytes = 4000) =>
    request(app).post(`/rooms/${roomId}/groups/recording?${q}`).set('authorization', `Bearer ${token}`).set('cookie', cookies.get(token) ?? '').set('content-type', type).send(bytes === 4000 ? wave() : Buffer.alloc(bytes, 1));
  async function discussingRoom() {
    const r = await setupRoom(true);
    for (const p of [r.p1, r.p2]) await api(p).post(`/rooms/${r.roomId}/opinion`, { text: '意見' }).expect(200);
    return r;
  }
  it('同意・議論の開始・生徒であることを確かめる', async () => {
    const { roomId, mod, p1, p2 } = await setupRoom(true);
    await upload(p1, roomId).expect(409); // 議論が始まる前
    for (const p of [p1, p2]) await api(p).post(`/rooms/${roomId}/opinion`, { text: '意見' }).expect(200);
    await upload(p1, roomId, 'durationSec=600').expect(400); // 同意がない
    await upload(mod, roomId).expect(403); // 先生は送らない（生徒の端末で録音する）
    await upload(await anon(), roomId).expect(403); // メンバー外
    await upload(p1, roomId, 'consent=1&durationSec=600', 'text/plain').expect(415);
    await upload(p1, roomId, 'consent=1&durationSec=2000').expect(413); // 30分を超える
    await upload(p1, roomId, 'consent=1&durationSec=600', 'audio/webm', 10).expect(400); // 空
  });
  it('分析の結果を results/flow-g{番号} に保存し、グループに1回だけ分析する', async () => {
    const { roomId, p1, p2 } = await discussingRoom();
    const r = await upload(p1, roomId, 'consent=1&durationSec=600', 'audio/wav').expect(200);
    expect(r.body).toMatchObject({ group: 1, status: 'done', speechDetected: true, totalMinutes: 10, source: 'mock' });
    const flow = (await db.doc(`sessions/${roomId}/results/flow-g1`).get()).data();
    expect(flow).toMatchObject({ group: 1, totalMinutes: 10, durationSec: 600, source: 'mock' });
    expect(flow?.segments.length).toBeGreaterThan(0);
    expect(flow?.behaviors).toHaveProperty('questions');
    expect(JSON.stringify(flow)).not.toContain(uidOf(p1)); // 話者を記録しない
    expect((await db.doc(`sessions/${roomId}`).get()).get('groupState')['1'].recording.status).toBe('done');
    await upload(p2, roomId).expect(409); // 同じグループの2台目の送信は分析しない
  });
  it('Gemini が失敗したら 503 で、30秒あけて同じ録音を送り直せる。分析はグループごとに3回まで', async () => {
    const { roomId, p1 } = await discussingRoom();
    fail = true;
    await upload(p1, roomId).expect(503);
    expect((await db.doc(`sessions/${roomId}`).get()).get('groupState')['1'].recording.status).toBe('failed');
    const wait = await upload(p1, roomId).expect(429); // 失敗の直後
    expect(wait.body.error).toMatchObject({ code: 'cooldown' });
    expect(wait.body.error.retryAfterSec).toBeGreaterThan(0);
    clock += 31_000;
    await upload(p1, roomId).expect(503); // 2回目
    clock += 31_000;
    fail = false;
    await upload(p1, roomId).expect(200); // 3回目
    expect((await db.doc(`sessions/${roomId}`).get()).get('groupState')['1'].recording.attempts).toBe(3);
  });
  it('3回失敗したグループは、それ以上 Gemini を呼ばない', async () => {
    const { roomId, p1 } = await discussingRoom();
    fail = true;
    for (let i = 0; i < 3; i++) { await upload(p1, roomId).expect(503); clock += 31_000; }
    fail = false;
    const r = await upload(p1, roomId).expect(429);
    expect(r.body.error).toMatchObject({ code: 'too_many_attempts' });
  });
  it('大きすぎる録音は 413', async () => {
    const { roomId, p1 } = await discussingRoom();
    const r = await upload(p1, roomId, 'consent=1&durationSec=600', 'audio/webm', 12 * 1024 * 1024 + 1).expect(413);
    expect(r.body.error).toMatchObject({ code: 'too_large' });
  });
  it('先生が録音を使わない設定にした部屋では送れない', async () => {
    const mod = await named(); const p1 = await anon();
    const { roomId, joinCode } = (await api(mod).post('/rooms', { title: '録音なし', recording: false }).expect(201)).body;
    await api(p1).post('/rooms/join', { code: joinCode }).expect(200);
    await api(p1).post(`/rooms/${roomId}/opinion`, { text: '意見' }).expect(200);
    await upload(p1, roomId).expect(403);
  });
});

describe('承認と合意の検証', () => {
  it('参加者は承認できず、司会者は承認でき、2回目は 409', async () => {
    const { roomId, mod, p1 } = await setupRoom();
    await toDiscussing(mod, roomId, ['透明性を確保すべき'], []);
    await api(mod).post(`/rooms/${roomId}/analyze`).expect(200);
    const id = (await db.collection(`sessions/${roomId}/insights`).get()).docs[0].id;
    await api(p1).post(`/rooms/${roomId}/insights/${id}/approve`).expect(403);
    await api(mod).post(`/rooms/${roomId}/insights/${id}/approve`).expect(200);
    await api(mod).post(`/rooms/${roomId}/insights/${id}/approve`).expect(409);
  });
  it('合意の一文のずれと4つの指標を計算する', async () => {
    const { roomId, mod, p1, p2 } = await setupRoom();
    await toDiscussing(mod, roomId, ['透明性を確保すべき', '費用が心配'], [[uidOf(p1), '費用が心配です'], [uidOf(p1), 'そうですね']]);
    await api(mod).post(`/rooms/${roomId}/analyze`).expect(200);
    const id = (await db.collection(`sessions/${roomId}/insights`).get()).docs[0].id;
    await api(mod).post(`/rooms/${roomId}/insights/${id}/approve`).expect(200);
    await db.collection(`sessions/${roomId}/messages`).add({ uid: uidOf(p2), text: '透明性を確保すべきだと思う', createdAt: FieldValue.serverTimestamp() });
    await api(mod).post(`/rooms/${roomId}/phase`, { to: 'consensus' }).expect(200);
    await db.doc(`sessions/${roomId}/consensusStatements/${uidOf(p1)}`).set({ text: '申告すれば利用可', agreement: 4, updatedAt: FieldValue.serverTimestamp() });
    await db.doc(`sessions/${roomId}/consensusStatements/${uidOf(p2)}`).set({ text: '教員の許可があれば利用可', agreement: 5, updatedAt: FieldValue.serverTimestamp() });
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

describe('P1: 非公開情報と状態変更の回帰', () => {
  const postTo = (target: ReturnType<typeof createApp>, token: string, path: string, body: object = {}) =>
    request(target).post(path).set('authorization', `Bearer ${token}`).set('cookie', cookies.get(token) ?? '').send(body);
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
  };
  async function consensusRoom() {
    const r = await setupRoom();
    await db.doc(`sessions/${r.roomId}`).update({ phase: 'consensus', groupState: { '1': { status: 'consensus' } } });
    for (const p of [r.p1, r.p2]) await db.doc(`sessions/${r.roomId}/consensusStatements/${uidOf(p)}`).set({ text: '合成の結論', agreement: 3 });
    return r;
  }

  it('JSON解析失敗と予期しないDBエラーでも、本文・トークンをログや応答に出さない', async () => {
    const { mod, roomId } = await setupRoom();
    const marker = 'synthetic-private-error-marker';
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const bad = await request(app).post('/rooms').set('content-type', 'application/json').send(`{"text":"${marker}"`);
      expect(bad.status).toBe(400);
      expect(log).not.toHaveBeenCalled();
      const failingDb = new Proxy(db, { get(target, key) {
        if (key === 'doc') return () => { throw Object.assign(new Error(marker), { body: marker }); };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
      const target = createApp({ db: failingDb, auth: getAuth(), gemini: mockGemini() });
      const failed = await postTo(target, mod, `/rooms/${roomId}/phase`, { to: 'discussing' }).expect(500);
      expect(log).toHaveBeenCalledWith('api_internal_error');
      expect(JSON.stringify([log.mock.calls, bad.body, failed.body])).not.toContain(marker);
      expect(JSON.stringify(log.mock.calls)).not.toContain(mod);
    } finally { log.mockRestore(); }
  });

  it('Geminiの生の例外文を、部屋のanalysis.errorへ保存しない', async () => {
    const { roomId, mod } = await setupRoom();
    const target = createApp({ db, auth: getAuth(), gemini: { ...mockGemini(), findPoints: async () => { throw new Error('synthetic-private-provider-error'); } } });
    await postTo(target, mod, `/rooms/${roomId}/analyze`).expect(503);
    const room = (await db.doc(`sessions/${roomId}`).get()).data();
    expect(room?.analysis).toMatchObject({ status: 'failed', error: 'gemini_unavailable' });
    expect(JSON.stringify(room)).not.toContain('synthetic-private-provider-error');
  });

  it('1グループの議論開始後は、新しい参加者を自動割当しない。既存メンバーは再参加できる', async () => {
    const { roomId, mod, p1, p2, joinCode } = await setupRoom(true);
    for (const p of [p1, p2]) await api(p).post(`/rooms/${roomId}/opinion`, { text: '合成の意見' }).expect(200);
    const newcomer = await anon();
    await api(newcomer).post('/rooms/join', { code: joinCode }).expect(409);
    expect((await db.doc(`sessions/${roomId}/members/${uidOf(newcomer)}`).get()).exists).toBe(false);
    await api(p1).post('/rooms/join', { code: joinCode }).expect(200);
    await api(mod).post('/rooms/join', { code: joinCode }).expect(200);
    expect((await db.doc(`sessions/${roomId}`).get()).get('groupState')['1'].total).toBe(2);
  });

  it('グループ選択と開始を同時に行っても、開始時の人数と所属が一致する', async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const mod = await named(); const p1 = await anon(); const p2 = await anon();
      const { roomId, joinCode } = (await api(mod).post('/rooms', { title: '競合試験', groups: 2 }).expect(201)).body;
      for (const p of [p1, p2]) await api(p).post('/rooms/join', { code: joinCode }).expect(200);
      await api(p1).post(`/rooms/${roomId}/groups/choose`, { group: 1 }).expect(200);
      await api(p2).post(`/rooms/${roomId}/groups/choose`, { group: 2 }).expect(200);
      const [moved, started] = await Promise.all([
        api(p1).post(`/rooms/${roomId}/groups/choose`, { group: 2 }),
        api(mod).post(`/rooms/${roomId}/groups/start`, { group: 2 }),
      ]);
      expect(started.status).toBe(200);
      expect([200, 409]).toContain(moved.status);
      const members = await db.collection(`sessions/${roomId}/members`).where('group', '==', 2).get();
      expect(started.body.total).toBe(members.size);
      expect((await db.doc(`sessions/${roomId}`).get()).get('groupState')['2']).toMatchObject({ status: 'discussing', total: members.size });
    }
  }, 30_000); // Firestoreの競合時バックオフを含む3回の同時操作を検査する。

  it('closed後は、回答・グループ開始/終了/移動・分析・録音を受け付けず、状態を変えない', async () => {
    const { roomId, mod, p1 } = await setupRoom();
    const ref = db.doc(`sessions/${roomId}`);
    await ref.update({ phase: 'closed', groupState: { '1': { status: 'consensus', total: 2 } } });
    const before = (await ref.get()).data();
    for (const [token, suffix, body] of [
      [p1, 'opinion', { text: '締切後' }], [p1, 'statement', { text: '締切後', agreement: 3 }],
      [p1, 'groups/end', {}], [p1, 'groups/choose', { group: 1 }],
      [mod, 'groups/start', { group: 1 }], [mod, 'groups/analyze', { group: 1 }],
      [p1, 'groups/analyze', {}], [mod, 'consensus/analyze', {}],
    ] as [string, string, object][]) await api(token).post(`/rooms/${roomId}/${suffix}`, body).expect(409);
    await request(app).post(`/rooms/${roomId}/groups/recording?consent=1&durationSec=10`)
      .set('authorization', `Bearer ${p1}`).set('cookie', cookies.get(p1) ?? '').set('content-type', 'audio/wav').send(wave(10, 8000)).expect(409);
    expect((await ref.get()).data()).toEqual(before);
    expect((await db.doc(`sessions/${roomId}/consensusStatements/${uidOf(p1)}`).get()).exists).toBe(false);
  });

  it('部屋全体の合意分析も、同時実行を409・30秒以内を429で拒否する', async () => {
    const { roomId, mod } = await consensusRoom();
    const entered = deferred(); const release = deferred(); const base = mockGemini();
    const compare = vi.fn(async (...args: Parameters<typeof base.compare>) => { entered.resolve(); await release.promise; return base.compare(...args); });
    const target = createApp({ db, auth: getAuth(), gemini: { ...base, compare }, now: () => clock });
    const first = postTo(target, mod, `/rooms/${roomId}/consensus/analyze`).then((r) => r);
    await entered.promise;
    try { await postTo(target, mod, `/rooms/${roomId}/consensus/analyze`).expect(409); }
    finally { release.resolve(); }
    expect((await first).status).toBe(200);
    expect(compare).toHaveBeenCalledTimes(1);
    const limited = await postTo(target, mod, `/rooms/${roomId}/consensus/analyze`).expect(429);
    expect(limited.body.error.retryAfterSec).toBe(30);
    clock += 31_000;
    await postTo(target, mod, `/rooms/${roomId}/consensus/analyze`).expect(200);
  });

  it('合意分析の期限切れ後に新しい結果が出ても、古い処理は上書きできない', async () => {
    const { roomId, mod } = await consensusRoom();
    const entered = deferred(); const release = deferred(); const base = mockGemini(); let calls = 0;
    const compare: typeof base.compare = async () => {
      const first = calls++ === 0;
      if (first) { entered.resolve(); await release.promise; }
      return { groups: [{ label: first ? '古い結果' : '新しい結果', members: [0, 1] }], addressedInsightIds: [] };
    };
    const target = createApp({ db, auth: getAuth(), gemini: { ...base, compare }, now: () => clock });
    const old = postTo(target, mod, `/rooms/${roomId}/consensus/analyze`).then((r) => r);
    await entered.promise; clock += 61_000;
    try { await postTo(target, mod, `/rooms/${roomId}/consensus/analyze`).expect(200); }
    finally { release.resolve(); }
    expect((await old).status).toBe(409);
    expect((await db.doc(`sessions/${roomId}/results/summary`).get()).get('groups')[0].label).toBe('新しい結果');
  });

  it('合意分析が失敗しても固定コードを保存し、30秒後に再試行できる', async () => {
    const { roomId, mod } = await consensusRoom(); fail = true;
    await api(mod).post(`/rooms/${roomId}/consensus/analyze`).expect(503);
    expect((await db.doc(`sessions/${roomId}`).get()).get('consensusAnalysis.status')).toBe('failed');
    await api(mod).post(`/rooms/${roomId}/consensus/analyze`).expect(429);
    fail = false; clock += 31_000;
    await api(mod).post(`/rooms/${roomId}/consensus/analyze`).expect(200);
  });

  it.each(['groups/analyze', 'consensus/analyze', 'groups/recording'])('%sの実行中にclosedになったら、結果を書き戻さない', async (suffix) => {
    const { roomId, mod, p1 } = await consensusRoom();
    const entered = deferred(); const release = deferred(); const base = mockGemini();
    const target = createApp({ db, auth: getAuth(), now: () => clock, gemini: {
      ...base,
      compare: async (...args) => { entered.resolve(); await release.promise; return base.compare(...args); },
      analyzeDiscussion: async (...args) => { entered.resolve(); await release.promise; return base.analyzeDiscussion(...args); },
    } });
    const recording = suffix === 'groups/recording';
    const pending = recording
      ? request(target).post(`/rooms/${roomId}/${suffix}?consent=1&durationSec=10`).set('authorization', `Bearer ${p1}`).set('cookie', cookies.get(p1) ?? '').set('content-type', 'audio/wav').send(wave(10, 8000)).then((r) => r)
      : postTo(target, mod, `/rooms/${roomId}/${suffix}`, { group: 1 }).then((r) => r);
    await entered.promise;
    try { await api(mod).post(`/rooms/${roomId}/phase`, { to: 'closed' }).expect(200); }
    finally { release.resolve(); }
    const response = await pending;
    if (suffix === 'groups/analyze') expect(response.body).toMatchObject({ analyzed: false, skipped: 'stale' });
    else expect(response.status).toBe(409);
    const resultId = suffix === 'groups/analyze' ? 'group-1' : recording ? 'flow-g1' : 'summary';
    expect((await db.doc(`sessions/${roomId}/results/${resultId}`).get()).exists).toBe(false);
    expect((await db.doc(`sessions/${roomId}`).get()).get('phase')).toBe('closed');
  });
});

describe('認証・入力攻撃・再送の境界', () => {
  it('Google以外の参加と、他セッションでのHost権限の自己申告を拒否する', async () => {
    const { roomId, joinCode, p1 } = await setupRoom();
    await api(await anonymous()).post('/rooms/join', { code: joinCode }).expect(403);
    const password = await signUp({ email: `password-${Date.now()}@example.com`, password: 'password' }); // submit-allow: エミュレータ専用のダミー
    await api(password).post('/rooms/join', { code: joinCode }).expect(403);
    await api(p1).post('/rooms', { title: '新しいセッション', teacher: true, role: 'host' }).expect(201);
    expect((await db.doc(`sessions/${roomId}/members/${uidOf(p1)}`).get()).get('role')).toBe('participant');
    await api(p1).post(`/rooms/${roomId}/phase`, { to: 'discussing' }).expect(403);
    await api(p1).post(`/rooms/${roomId}/analyze`, { role: 'host' }).expect(403);
  });
  it('無効化されたアカウントと改ざんトークンを拒否する', async () => {
    const token = await anon(); await getAuth().updateUser(uidOf(token), { disabled: true });
    await api(token).post('/rooms/join', { code: 'DEMO01' }).expect(401);
    await api('not.a.token').post('/rooms', { title: 'x' }).expect(401);
  });
  it('参加コード総当たりは利用者単位に制限し、窓が過ぎたら復帰する', async () => {
    const token = await anon();
    for (let i = 0; i < 30; i++) await api(token).post('/rooms/join', { code: 'ZZZZZZ' }).expect(404);
    const response = await api(token).post('/rooms/join', { code: 'ZZZZZZ' }).expect(429);
    expect(response.headers['retry-after']).toBe('60');
    clock += 60_000; await api(token).post('/rooms/join', { code: 'ZZZZZZ' }).expect(404);
  });
  it('同じ録音を同じ利用者が再送しても結果・試行回数を重複させない', async () => {
    const { roomId, mod, p1 } = await setupRoom();
    await api(mod).post(`/rooms/${roomId}/groups/start`, { group: 1 }).expect(200);
    const send = () => request(app).post(`/rooms/${roomId}/groups/recording?consent=1&durationSec=2`)
      .set('authorization', `Bearer ${p1}`).set('cookie', cookies.get(p1) ?? '').set('content-type', 'audio/wav').send(wave(2, 8000));
    const first = await send().expect(200); const second = await send().expect(200);
    expect(second.body).toEqual(first.body);
    expect((await db.doc(`sessions/${roomId}`).get()).get('groupState.1.recording.attempts')).toBe(1);
  });
  it('音声の偽装と入力過大を、分析の試行枠を消費せず拒否する', async () => {
    const { roomId, mod, p1 } = await setupRoom();
    await api(mod).post(`/rooms/${roomId}/groups/start`, { group: 1 }).expect(200);
    await request(app).post(`/rooms/${roomId}/groups/recording?consent=1&durationSec=2`)
      .set('authorization', `Bearer ${p1}`).set('cookie', cookies.get(p1) ?? '').set('content-type', 'audio/webm').send(wave(2)).expect(400);
    expect((await db.doc(`sessions/${roomId}`).get()).get('groupState.1.recording')).toBeUndefined();
    await api(p1).post(`/rooms/${roomId}/opinion`, { text: 'x'.repeat(40_000) }).expect(413);
  });
  it('計測には固定された操作名・応答・所要時間だけを含み、入力本文を出さない', async () => {
    const events: unknown[] = [];
    const target = createApp({ db, auth: getAuth(), gemini: mockGemini(), observe: (event) => events.push(event) });
    const token = await anon();
    const response = await request(target).post('/rooms').set('authorization', `Bearer ${token}`).set('cookie', cookies.get(token) ?? '').send({ title: 'PRIVATE-TEXT' }).expect(201);
    expect(response.headers['x-request-id']).toMatch(/^[\da-f-]{36}$/);
    expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ route: '/rooms', status: 201 });
    expect(JSON.stringify(events)).not.toContain(token); expect(JSON.stringify(events)).not.toContain('PRIVATE-TEXT');
  });
});

it('パスの階層偽装とJSON条件式の注入を受け付けない', async () => {
  const token = await anon();
  await api(token).post('/rooms/a%2Fmembers%2Fb/progress').expect(400);
  await api(token).post('/rooms/join', { code: { $ne: null } }).expect(400);
  await api(token).post('/rooms/join', { code: 'A'.repeat(1000) }).expect(400);
});

it('分析中とクラス結果確定後の回答更新で、分析結果を古くしない', async () => {
  const { roomId, mod, p1, p2 } = await setupRoom();
  await api(mod).post(`/rooms/${roomId}/groups/start`, { group: 1 }).expect(200);
  await api(p1).post(`/rooms/${roomId}/groups/end`).expect(200);
  await api(p1).post(`/rooms/${roomId}/statement`, { text: '元の回答', agreement: 3 }).expect(200);
  const { entered, release, post } = blocked('compare');
  const pending = post(p2, `/rooms/${roomId}/statement`, { text: 'b', agreement: 3 }).then((r) => r);
  await entered.promise;
  try {
    await api(p1).post(`/rooms/${roomId}/statement`, { text: '途中の変更', agreement: 5 }).expect(409);
    expect((await db.doc(`sessions/${roomId}/consensusStatements/${uidOf(p1)}`).get()).get('text')).toBe('元の回答');
  } finally { release.resolve(); }
  expect((await pending).status).toBe(200);
  for (const status of ['running', 'done']) {
    await db.doc(`sessions/${roomId}`).update({ 'groupState.1.status': 'consensus', consensusAnalysis: { status } });
    await api(p1).post(`/rooms/${roomId}/statement`, { text: '変更', agreement: 5 }).expect(409);
  }
});

describe('Zod・Admin SDK更新後のAPI互換性', () => {
  it('省略したグループ数と録音設定の既定値を維持する', async () => {
    const result = await api(await named()).post('/rooms', { title: '依存更新の確認' }).expect(201);
    const room = (await db.doc(`sessions/${result.body.roomId}`).get()).data();
    expect(room).toMatchObject({ title: '依存更新の確認', groups: 1, recording: true, phase: 'collecting' });
  });
  it.each([{ groups: '2' }, { recording: 'false' }, { title: '' }])('入力の型・必須値の制約を維持する: %j', async (patch) => {
    const result = await api(await named()).post('/rooms', { title: '依存更新の確認', ...patch }).expect(400);
    expect(result.body.error.code).toBe('bad_request');
  });
});
