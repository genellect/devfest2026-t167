import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../src/app.js';
import { mockGemini } from '../../src/gemini.js';
import { mockVoice } from '../../src/mvp-voice.js';

process.env.GOOGLE_CLOUD_PROJECT = 'demo-t167';
const admin = initializeApp({ projectId: 'demo-t167' }, 'mvp-tests'), db = getFirestore(admin);
let clock = Date.now(), failAi = false;
const app = createApp({ db, auth: getAuth(admin), gemini: mockGemini({ fail: () => failAi }), voice: mockVoice, now: () => clock });
const settings = { title: 'MVPの議論', theme: '架空の秘密テーマ', groups: 2, minutes: 1, recording: true, visible: { theme: true, timer: true, members: true }, publishOnEnd: false };
async function identity(anonymous = false) {
  const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099'}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true, ...(!anonymous ? { email: `${randomUUID()}@example.com`, password: 'password' } : {}) }), // submit-allow: エミュレータ専用のダミー
  });
  const data = await response.json(); return { token: data.idToken as string, uid: data.localId as string };
}
function post(token: string, path: string, data: object = {}) { return request(app).post(`/discussions${path}`).set('authorization', `Bearer ${token}`).send(data); }
function state(token: string, id: string) { return request(app).get(`/discussions/room/${id}`).set('authorization', `Bearer ${token}`); }
async function fixture(shared = false) {
  const host = await identity(), guest = await identity();
  const created = await post(host.token, '/create', settings).expect(201), id = created.body.id as string;
  const hostState = await state(host.token, id).expect(200);
  await post(guest.token, '/join', { code: hostState.body.code }).expect(200);
  await post(guest.token, `/room/${id}/names`, { mode: shared ? 'shared' : 'personal', names: shared ? ['架空のA', '架空のB'] : ['架空のA'], group: 1 }).expect(200);
  return { host, guest, id, code: hostState.body.code as string };
}
async function register(token: string, id: string) {
  const own = (await state(token, id)).body.own;
  for (const attendee of own.attendees) {
    await request(app).post(`/discussions/room/${id}/voice/${attendee.id}?consent=1`).set('authorization', `Bearer ${token}`).set('content-type', 'audio/pcm').send(Buffer.alloc(288000, 1)).expect(200);
  }
}
async function recordingFixture() {
  const f = await fixture(); await register(f.guest.token, f.id);
  await post(f.host.token, `/room/${f.id}/start`).expect(200);
  const claim = await post(f.guest.token, `/room/${f.id}/claim-recording`).expect(200);
  await post(f.host.token, `/room/${f.id}/finish`).expect(200);
  return { ...f, runId: claim.body.runId as string };
}
function upload(f: { id: string; runId: string; guest: { token: string } }) {
  return request(app).post(`/discussions/room/${f.id}/recording?consent=1&seconds=9&runId=${f.runId}`).set('authorization', `Bearer ${f.guest.token}`).set('content-type', 'audio/wav').send(Buffer.alloc(288044, 1));
}
beforeEach(() => { clock = Date.now(); failAi = false; });
describe('DocsのMVPフローと認可', () => {
  it('未認証・匿名参加を拒否する', async () => {
    await request(app).get('/discussions/list').expect(401);
    await post((await identity(true)).token, '/create', settings).expect(403);
  });
  it('作成者にだけHostを付与し、未知のrole入力を拒否する', async () => {
    const host = await identity(); await post(host.token, '/create', { ...settings, role: 'host' }).expect(400);
    const f = await fixture(); expect((await state(f.host.token, f.id)).body.role).toBe('host'); expect((await state(f.guest.token, f.id)).body.role).toBe('guest');
    await post(f.guest.token, `/room/${f.id}/settings`, { published: true }).expect(403);
    await post(f.guest.token, `/room/${f.id}/start`).expect(403);
    await post(f.guest.token, `/room/${f.id}/finish`).expect(403);
  });
  it('他の議論や本人以外の一覧を読み出せない', async () => {
    const f = await fixture(), outsider = await identity(); await state(outsider.token, f.id).expect(403);
    const list = await request(app).get('/discussions/list').set('authorization', `Bearer ${outsider.token}`); expect(list.body.discussions).toEqual([]);
    const own = await request(app).get('/discussions/list').set('authorization', `Bearer ${f.guest.token}`); expect(own.body.discussions[0]).toMatchObject({ id: f.id, role: 'guest' });
  });
  it('未登録のGuestがいる間は開始できず、登録後の再読込も同じ参加者になる', async () => {
    const f = await fixture(); await post(f.host.token, `/room/${f.id}/start`).expect(409);
    await register(f.guest.token, f.id); expect((await state(f.guest.token, f.id)).body.own.ready).toBe(true);
    await post(f.host.token, `/room/${f.id}/start`).expect(200);
    await post(f.guest.token, '/join', { code: f.code }).expect(200);
    const late = await identity(); await post(late.token, '/join', { code: f.code }).expect(409);
  });
  it('個人の声を次回再利用し、本人の削除後は再登録を求める', async () => {
    const f = await fixture(); await register(f.guest.token, f.id);
    const next = await post(f.host.token, '/create', settings), id = next.body.id;
    await post(f.guest.token, '/join', { code: (await state(f.host.token, id)).body.code });
    await post(f.guest.token, `/room/${id}/names`, { mode: 'personal', names: ['次回の名前'], group: 1 });
    expect((await state(f.guest.token, id)).body.own.ready).toBe(true);
    await post(f.guest.token, '/voice/delete').expect(200);
    await post(f.guest.token, `/room/${id}/names`, { mode: 'personal', names: ['再登録'], group: 1 });
    expect((await state(f.guest.token, id)).body.own.ready).toBe(false);
  });
  it('共有端末は全員の声を登録し、終了時にその回の特徴を削除する', async () => {
    const f = await fixture(true); await register(f.guest.token, f.id);
    expect((await db.collection(`mvpDiscussions/${f.id}/voices`).get()).size).toBe(2);
    await post(f.host.token, `/room/${f.id}/start`); await post(f.host.token, `/room/${f.id}/finish`);
    expect((await db.collection(`mvpDiscussions/${f.id}/voices`).get()).empty).toBe(true);
  });
  it('同意なし・短すぎる音声・他人の登録先を拒否する', async () => {
    const f = await fixture(), own = (await state(f.guest.token, f.id)).body.own;
    const base = `/discussions/room/${f.id}/voice/${own.attendees[0].id}`;
    await request(app).post(base).set('authorization', `Bearer ${f.guest.token}`).set('content-type', 'audio/pcm').send(Buffer.alloc(288000)).expect(403);
    await request(app).post(`${base}?consent=1`).set('authorization', `Bearer ${f.guest.token}`).set('content-type', 'audio/pcm').send(Buffer.alloc(16)).expect(400);
    await request(app).post(`/discussions/room/${f.id}/voice/other?consent=1`).set('authorization', `Bearer ${f.guest.token}`).set('content-type', 'audio/pcm').send(Buffer.alloc(288000)).expect(404);
  });
  it('表示を許可していないテーマ・時刻・名簿をレスポンスから除外する', async () => {
    const f = await fixture(); await post(f.host.token, `/room/${f.id}/settings`, { visible: { theme: false, timer: false, members: false } });
    const value = (await state(f.guest.token, f.id)).body; expect(value.theme).toBeNull(); expect(value.endsAt).toBeNull(); expect(value.members).toEqual([]); expect(value.code).toBeUndefined();
    expect(JSON.stringify(value)).not.toContain('架空の秘密テーマ'); expect(JSON.stringify(value)).not.toContain('embedding');
  });
  it('タイムアウトをサーバーで確定し、終了後の設定変更・音声登録を拒否する', async () => {
    const f = await fixture(); await register(f.guest.token, f.id); await post(f.host.token, `/room/${f.id}/start`);
    clock += 61000;
    expect((await state(f.guest.token, f.id)).body).toMatchObject({ phase: 'ended', endReason: 'timeout' });
    await post(f.host.token, `/room/${f.id}/settings`, { minutes: 20 }).expect(409);
    await post(f.guest.token, `/room/${f.id}/names`, { mode: 'personal', names: ['変更'], group: 1 }).expect(409);
  });
  it('録音は同じグループの1端末だけが担当し、別端末の送信を拒否する', async () => {
    const f = await fixture(), second = await identity(); await post(second.token, '/join', { code: f.code }); await post(second.token, `/room/${f.id}/names`, { mode: 'personal', names: ['別端末'], group: 1 });
    await register(f.guest.token, f.id); await register(second.token, f.id); await post(f.host.token, `/room/${f.id}/start`);
    await post(f.guest.token, `/room/${f.id}/claim-recording`).expect(200); await post(second.token, `/room/${f.id}/claim-recording`).expect(409);
  });
  it('分析後の再送を重複実行せず、Host公開前はGuestへ結果を返さない', async () => {
    const f = await recordingFixture(); await upload(f).expect(200); expect((await upload(f)).body.duplicate).toBe(true);
    expect((await state(f.guest.token, f.id)).body.results).toEqual([]);
    expect((await state(f.host.token, f.id)).body.results).toHaveLength(1);
    await post(f.host.token, `/room/${f.id}/settings`, { published: true }); expect((await state(f.guest.token, f.id)).body.results).toHaveLength(1);
    await post(f.host.token, `/room/${f.id}/settings`, { published: false }); expect((await state(f.guest.token, f.id)).body.results).toEqual([]);
  });
  it('別グループの結果を隠し、AI失敗の再送制限と5分の受付期限を守る', async () => {
    const f = await recordingFixture(); failAi = true; await upload(f).expect(503); await upload(f).expect(429);
    clock += 31000; failAi = false; await upload(f).expect(200);
    await db.doc(`mvpDiscussions/${f.id}/results/2`).set({ private: '別グループの結果' });
    await post(f.host.token, `/room/${f.id}/settings`, { published: true }); expect(JSON.stringify((await state(f.guest.token, f.id)).body)).not.toContain('別グループの結果');
    clock += 5 * 60000; await upload(f).expect(409);
  });
});
