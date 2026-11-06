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
  async function classRoom(groups: number, n: number) {
    const mod = await named();
    const { roomId, joinCode } = (await api(mod).post('/rooms', { title: 'グループ', groups }).expect(201)).body;
    const ps: string[] = [];
    for (let i = 0; i < n; i++) { const p = await anon(); await api(p).post('/rooms/join', { code: joinCode }).expect(200); ps.push(p); }
    return { mod, roomId, ps };
  }
  const state = async (roomId: string, g: number) => (await db.doc(`rooms/${roomId}`).get()).get('groupState')?.[String(g)];

  it('グループが複数なら参加後に生徒が選ぶ。1つなら自動でグループ1', async () => {
    const one = await classRoom(1, 1);
    expect((await db.doc(`rooms/${one.roomId}/members/${uidOf(one.ps[0])}`).get()).get('group')).toBe(1);
    const { roomId, ps, mod } = await classRoom(2, 2);
    expect((await db.doc(`rooms/${roomId}/members/${uidOf(ps[0])}`).get()).get('group')).toBeUndefined();
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
    const r = await setupRoom();
    for (const p of [r.p1, r.p2]) await api(p).post(`/rooms/${r.roomId}/opinion`, { text: '意見' }).expect(200);
    return r;
  }
  it('生徒がグループの議論を終え、全員の一文がそろうとグループの結果が出る', async () => {
    const { roomId, mod, p1, p2 } = await setupRoom();
    const say = (t: string, text: string) => api(t).post(`/rooms/${roomId}/statement`, { text, agreement: 4 });
    await api(p1).post(`/rooms/${roomId}/opinion`, { text: '意見' }).expect(200);
    await api(p1).post(`/rooms/${roomId}/groups/end`).expect(409); // まだ議論が始まっていない
    await api(p2).post(`/rooms/${roomId}/opinion`, { text: '意見' }).expect(200);
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
    expect((await db.doc(`rooms/${roomId}/consensusStatements/${uidOf(p2)}`).get()).exists).toBe(true);
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
    expect((await api(p2).post(`/rooms/${roomId}/statement`, { text: 'b', agreement: 3 }).expect(200)).body.analyzed).toBe(true);
    const first = (await db.doc(`rooms/${roomId}/results/group-1`).get()).get('jobId');
    clock += 31_000;
    // 一文の送り直しと出し直しでは、Gemini を呼ばない
    expect((await api(p2).post(`/rooms/${roomId}/statement`, { text: 'c', agreement: 3 }).expect(200)).body).toMatchObject({ analyzed: false, skipped: 'done' });
    expect((await api(p2).post(`/rooms/${roomId}/groups/analyze`).expect(200)).body).toMatchObject({ analyzed: false, skipped: 'done' });
    expect((await db.doc(`rooms/${roomId}/results/group-1`).get()).get('jobId')).toBe(first);
    // 先生は出し直せるが、続けては出せない
    expect((await api(mod).post(`/rooms/${roomId}/groups/analyze`, { group: 1 }).expect(200)).body.analyzed).toBe(true);
    await api(mod).post(`/rooms/${roomId}/groups/analyze`, { group: 1 }).expect(429);
  });
  it('同時に分析が始まっても、Gemini を呼ぶのは1回だけ', async () => {
    const { roomId, mod, p1, p2 } = await discussing();
    await api(p1).post(`/rooms/${roomId}/groups/end`).expect(200);
    await api(p1).post(`/rooms/${roomId}/statement`, { text: 'a', agreement: 3 }).expect(200);
    delay = 300;
    const [auto, manual] = await Promise.all([
      api(p2).post(`/rooms/${roomId}/statement`, { text: 'b', agreement: 3 }),
      new Promise((r) => setTimeout(r, 100)).then(() => api(mod).post(`/rooms/${roomId}/groups/analyze`, { group: 1 })),
    ]);
    expect(auto.body.analyzed).toBe(true);
    expect(manual.status).toBe(200);
    expect(manual.body).toMatchObject({ analyzed: false, skipped: 'running' });
  });
  it('存在しないグループ番号は受け付けない', async () => {
    const { roomId, mod } = await setupRoom(); // グループは1つ
    await api(mod).post(`/rooms/${roomId}/groups/start`, { group: 2 }).expect(400);
    await api(mod).post(`/rooms/${roomId}/groups/analyze`, { group: 2 }).expect(400);
  });
});

describe('録音の分析', () => {
  const upload = (token: string, roomId: string, q = 'consent=1&durationSec=600', type = 'audio/webm', bytes = 4000) =>
    request(app).post(`/rooms/${roomId}/groups/recording?${q}`).set('authorization', `Bearer ${token}`).set('content-type', type).send(Buffer.alloc(bytes, 1));
  async function discussingRoom() {
    const r = await setupRoom();
    for (const p of [r.p1, r.p2]) await api(p).post(`/rooms/${r.roomId}/opinion`, { text: '意見' }).expect(200);
    return r;
  }
  it('同意・議論の開始・生徒であることを確かめる', async () => {
    const { roomId, mod, p1, p2 } = await setupRoom();
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
    const r = await upload(p1, roomId, 'consent=1&durationSec=600', 'audio/webm;codecs=opus').expect(200);
    expect(r.body).toMatchObject({ group: 1, status: 'done', speechDetected: true, totalMinutes: 10, source: 'mock' });
    const flow = (await db.doc(`rooms/${roomId}/results/flow-g1`).get()).data();
    expect(flow).toMatchObject({ group: 1, totalMinutes: 10, durationSec: 600, source: 'mock' });
    expect(flow?.segments.length).toBeGreaterThan(0);
    expect(flow?.behaviors).toHaveProperty('questions');
    expect(JSON.stringify(flow)).not.toContain(uidOf(p1)); // 話者を記録しない
    expect((await db.doc(`rooms/${roomId}`).get()).get('groupState')['1'].recording.status).toBe('done');
    await upload(p2, roomId).expect(409); // 同じグループの2台目の送信は分析しない
  });
  it('Gemini が失敗したら 503 で、30秒あけて同じ録音を送り直せる。分析はグループごとに3回まで', async () => {
    const { roomId, p1 } = await discussingRoom();
    fail = true;
    await upload(p1, roomId).expect(503);
    expect((await db.doc(`rooms/${roomId}`).get()).get('groupState')['1'].recording.status).toBe('failed');
    const wait = await upload(p1, roomId).expect(429); // 失敗の直後
    expect(wait.body.error).toMatchObject({ code: 'cooldown' });
    expect(wait.body.error.retryAfterSec).toBeGreaterThan(0);
    clock += 31_000;
    await upload(p1, roomId).expect(503); // 2回目
    clock += 31_000;
    fail = false;
    await upload(p1, roomId).expect(200); // 3回目
    expect((await db.doc(`rooms/${roomId}`).get()).get('groupState')['1'].recording.attempts).toBe(3);
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

describe('Zod・Admin SDK更新後のAPI互換性', () => {
  it('省略したグループ数と録音設定の既定値を維持する', async () => {
    const result = await api(await named()).post('/rooms', { title: '依存更新の確認' }).expect(201);
    const room = (await db.doc(`rooms/${result.body.roomId}`).get()).data();
    expect(room).toMatchObject({ title: '依存更新の確認', groups: 1, recording: true, phase: 'collecting' });
  });
  it.each([{ groups: '2' }, { recording: 'false' }, { title: '' }])('入力の型・必須値の制約を維持する: %j', async (patch) => {
    const result = await api(await named()).post('/rooms', { title: '依存更新の確認', ...patch }).expect(400);
    expect(result.body.error.code).toBe('bad_request');
  });
});
