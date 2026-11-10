import { expect, it, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { emulatorGoogleUser } from '../../../firebase/emulator-auth.mjs';
import { createApp } from '../../src/app.js';
import { mockGemini } from '../../src/gemini.js';
import type { VoiceProvider } from '../../src/dependencies.js';
import { SpeakerWorker } from '../../src/voice-worker.js';
const projectId = process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId?.startsWith('demo-')) throw new Error('デモプロジェクトだけで検査します');
initializeApp({ projectId }); const db = getFirestore(), auth = getAuth();
let now = Date.now(), slot = 0, silent = false, ambiguity = false, failure = false;
let during: (() => Promise<void>) | undefined;
let barrier: Promise<void> | undefined, entered = 0;
const vector = (index: number) => Array.from({ length: 16 }, (_, i) => i === index ? 1 : 0);
const voice: VoiceProvider = { version: 'speaker-test-v1', source: 'mock', extract: async (pcm) => {
  if (barrier) { entered++; await barrier; }
  if (failure) throw new Error('private exception');
  if (during) { const fn = during; during = undefined; await fn(); }
  return { embedding: silent ? null : ambiguity ? vector(0).map((n, i) => n || (i === 1 ? 1 : 0)) : vector(slot), speechMs: silent ? 0 : Math.min(pcm.length / 32, 8000) };
} };
const deps = { db, auth, gemini: mockGemini(), voice, now: () => now }, app = createApp(deps);
beforeEach(() => { now = Date.now(); slot = 0; silent = false; ambiguity = false; failure = false; during = undefined; barrier = undefined; entered = 0; });
async function client(target = app, kind: 'teacher' | 'student' = 'student') {
  const u = await emulatorGoogleUser(kind, `speaker-${randomUUID()}`);
  const session = await request(target).post('/sessions').set('authorization', `Bearer ${u.idToken}`).send({ deviceLabel: '架空の端末', deviceType: 'tablet' }).expect(201);
  const headers = { authorization: `Bearer ${u.idToken}`, cookie: session.headers['set-cookie'][0].split(';')[0] };
  return { uid: u.localId, headers, target, post: (path: string, body = {}) => request(target).post(path).set(headers).send(body), get: (path: string) => request(target).get(path).set(headers) };
}
type Client = Awaited<ReturnType<typeof client>>;
async function register(c: Client, roomId: string, names: string[], audio?: Buffer[]) {
  await c.post(`/rooms/${roomId}/onboarding`, { mode: names.length > 1 ? 'shared' : 'personal', names }).expect(200);
  const attendees = (await db.doc(`sessions/${roomId}/members/${c.uid}`).get()).get('attendees') as { id: string }[];
  for (const [i, a] of attendees.entries()) {
    slot = i;
    await request(c.target).post(`/rooms/${roomId}/voice/${a.id}?consent=1`).set(c.headers).set('content-type', 'audio/pcm').send(audio?.[i] ?? Buffer.alloc(8 * 32000, 1)).expect(200);
  }
  slot = 0; return attendees.map((a) => a.id);
}
async function setup(target = app, audio?: Buffer[]) {
  const h = await client(target, 'teacher'), p = await client(target), q = await client(target);
  const r = (await h.post('/rooms', { title: '声の接続', flowVersion: 1, groups: 2, minutes: 2 }).expect(201)).body;
  for (const c of [p, q]) await c.post('/rooms/join', { code: r.joinCode }).expect(200);
  await h.post(`/rooms/${r.roomId}/groups/assign`, { uid: p.uid, group: 1 }).expect(200);
  await h.post(`/rooms/${r.roomId}/groups/assign`, { uid: q.uid, group: 2 }).expect(200);
  const ids = await register(p, r.roomId, ['声A', '声B'], audio);
  await register(q, r.roomId, ['別グループ'], audio ? [audio[0]] : undefined);
  return { h, p, q, roomId: r.roomId as string, ids };
}
const start = (c: Client, id: string) => c.post(`/rooms/${id}/speaker/start`, { consent: true });
const chunk = (c: Client, id: string, run: string, sequence = 0, pcm = Buffer.alloc(32000, 1)) => request(c.target).post(`/rooms/${id}/speaker/${run}/chunk?sequence=${sequence}`).set(c.headers).set('content-type', 'audio/pcm').send(pcm);
const stateRef = (id: string) => db.doc(`sessions/${id}/speaking/1`);
const begin = (h: Client, id: string) => h.post(`/rooms/${id}/phase`, { to: 'discussing' }).expect(200);
it('保存した共有端末の全員の声を使い、無音・曖昧な声を分けて集計し、再送を二重計上しない', async () => {
  const { h, p, roomId, ids } = await setup(); await begin(h, roomId);
  expect((await p.get(`/rooms/${roomId}/speaker/config`).expect(200)).body.source).toBe('mock');
  const run = (await start(p, roomId).expect(201)).body.runId;
  await chunk(p, roomId, run).expect(200); await chunk(p, roomId, run).expect(200);
  slot = 1; now += 1000; await chunk(p, roomId, run, 1).expect(200);
  ambiguity = true; now += 1000; await chunk(p, roomId, run, 2).expect(200);
  silent = true; now += 1000; await chunk(p, roomId, run, 3).expect(200);
  const state = (await stateRef(roomId).get()).data()!;
  expect(state.processedMs).toBe(4000); expect(state.talkMs).toEqual({ [ids[0]]: 1000, [ids[1]]: 1000 }); expect(state.unknownMs).toBe(1000); expect(state.latest).toBeNull();
  // 発言率の推移：同じ1分目に、話者ごとの時間と判別不能が入る（再送は二重計上しない）
  expect(state.timeline).toEqual([{ talkMs: { [ids[0]]: 1000, [ids[1]]: 1000 }, unknownMs: 1000 }]);
  expect(JSON.stringify(state)).not.toMatch(/embedding|audio|profilesHash/);
  await p.post(`/rooms/${roomId}/speaker/${run}/stop`).expect(200);
  expect((await db.doc(`sessions/${roomId}/speakerLeases/1`).get()).get('expiresAt')).toBe(0);
});
it('Host開始・録音担当・同意・同時接続・所属セッション・送信順序を検証する', async () => {
  const { h, p, q, roomId } = await setup();
  await start(p, roomId).expect(409); await begin(h, roomId);
  await start(h, roomId).expect(403);
  await p.post(`/rooms/${roomId}/speaker/start`, { consent: false }).expect(400);
  const run = (await start(p, roomId).expect(201)).body.runId;
  await start(p, roomId).expect(409);
  await chunk(q, roomId, run).expect(409);
  await chunk(p, roomId, run, 3).expect(409);
  await chunk(p, roomId, run, 0, Buffer.alloc(10)).expect(400);
  const outsider = await client(); await chunk(outsider, roomId, run).expect(403);
  await h.post(`/rooms/${roomId}/groups/update`, { group: 1, name: '担当指定', recorderUid: p.uid }).expect(200);
  await chunk(p, roomId, run).expect(200);
  await h.post(`/rooms/${roomId}/groups/update`, { group: 1, name: '担当解除', recorderUid: null }).expect(200);
  await h.post(`/rooms/${roomId}/finish`).expect(200);
  await chunk(p, roomId, run, 1).expect(409);
});
it('元のログインの活動時刻を背景送信で延長せず、新端末のログイン後は送信を拒否する', async () => {
  const { h, p, roomId } = await setup(); await begin(h, roomId);
  const sessions = db.collection(`users/${p.uid}/sessions`), before = (await sessions.get()).docs[0].get('lastActivityAt');
  now += 1000;
  const run = (await start(p, roomId).expect(201)).body.runId;
  await chunk(p, roomId, run).expect(200);
  expect((await sessions.get()).docs[0].get('lastActivityAt')).toEqual(before);
  await request(app).post('/sessions').set('authorization', p.headers.authorization).send({ deviceLabel: '別端末', deviceType: 'pc' }).expect(201);
  await chunk(p, roomId, run, 1).expect(401);
});
it('処理中の登録削除・失効・Host終了は結果確定前に検査する', async () => {
  const { h, p, q, roomId } = await setup(); await begin(h, roomId);
  const run = (await start(p, roomId).expect(201)).body.runId;
  during = async () => { await h.post(`/rooms/${roomId}/finish`).expect(200); };
  await chunk(p, roomId, run).expect(409);
  expect((await stateRef(roomId).get()).get('processedMs')).toBe(0);
  expect((await db.collection(`sessions/${roomId}/voiceProfiles`).get()).empty).toBe(true);
  expect((await db.doc(`users/${q.uid}/voiceProfiles/default`).get()).exists).toBe(true);
});
it('モデル未設定・登録削除・モデル変更・推論障害を成功扱いしない', async () => {
  const { h, p, roomId } = await setup(); await begin(h, roomId);
  const missing = createApp({ ...deps, voice: undefined });
  await request(missing).post(`/rooms/${roomId}/speaker/start`).set(p.headers).send({ consent: true }).expect(503);
  const run = (await start(p, roomId).expect(201)).body.runId;
  failure = true; const failed = await chunk(p, roomId, run).expect(503); expect(JSON.stringify(failed.body)).not.toContain('private exception'); failure = false;
  expect((await stateRef(roomId).get()).get('processedMs')).toBe(0);
  now += 21_000; await db.collection(`sessions/${roomId}/voiceProfiles`).get().then((s) => s.docs[0].ref.delete());
  await chunk(p, roomId, run).expect(409);
});
it('実時間より高速な送信と、登録情報の変更を拒否する', async () => {
  const { h, p, roomId } = await setup(); await begin(h, roomId);
  const run = (await start(p, roomId).expect(201)).body.runId;
  await chunk(p, roomId, run, 0).expect(200); await chunk(p, roomId, run, 1).expect(200);
  await chunk(p, roomId, run, 2).expect(409);
  now += 1000;
  const profile = (await db.collection(`sessions/${roomId}/voiceProfiles`).get()).docs[0];
  await profile.ref.update({ embedding: vector(2) });
  await chunk(p, roomId, run, 2).expect(409);
});
it('Host指定の担当者以外は同じグループでも録音を開始できない', async () => {
  const { h, p, roomId } = await setup(), other = await client();
  const code = (await db.doc(`sessions/${roomId}`).get()).get('joinCode');
  await other.post('/rooms/join', { code }).expect(200);
  await h.post(`/rooms/${roomId}/groups/assign`, { uid: other.uid, group: 1 }).expect(200);
  await register(other, roomId, ['同じ班の別端末']);
  await h.post(`/rooms/${roomId}/groups/update`, { group: 1, name: '担当指定', recorderUid: p.uid }).expect(200);
  await begin(h, roomId); await start(other, roomId).expect(403); await start(p, roomId).expect(201);
});
it('照合は直近3秒の声で行い、発言時間は最後の1秒だけを数える。1〜3秒以外の長さは受け付けない', async () => {
  const { h, p, roomId, ids } = await setup(); await begin(h, roomId);
  const run = (await start(p, roomId).expect(201)).body.runId;
  await chunk(p, roomId, run, 0, Buffer.alloc(48000, 1)).expect(400); // 1.5秒
  await chunk(p, roomId, run, 0, Buffer.alloc(4 * 32000, 1)).expect(413); // 4秒（受け付ける大きさを超える）
  await chunk(p, roomId, run, 0).expect(200); // 最初は1秒
  now += 1000; await chunk(p, roomId, run, 1, Buffer.alloc(2 * 32000, 1)).expect(200);
  now += 1000; await chunk(p, roomId, run, 2, Buffer.alloc(3 * 32000, 1)).expect(200);
  const state = (await stateRef(roomId).get()).data()!;
  // 3回で3秒。窓が長くても、二重に数えない
  expect(state.processedMs).toBe(3000);
  expect(state.talkMs[ids[0]]).toBe(3000);
  expect((await db.doc(`sessions/${roomId}/speakerLeases/1`).get()).get('bytes')).toBe(3 * 32000);
});
it('再利用した個人プロフィールが処理中に削除された場合、結果に計上しない', async () => {
  const { h, q, roomId } = await setup(); await begin(h, roomId);
  const run = (await start(q, roomId).expect(201)).body.runId;
  during = async () => { await q.post('/voice-profile/delete').expect(200); };
  await chunk(q, roomId, run).expect(409);
  expect((await db.doc(`sessions/${roomId}/speaking/2`).get()).get('processedMs')).toBe(0);
});
it('6グループが同時に音声を送っても、それぞれの登録済みの声で独立して集計する', async () => {
  const h = await client(app, 'teacher'), roomId = (await h.post('/rooms', { title: '6班同時', flowVersion: 1, groups: 6 }).expect(201)).body.roomId;
  const code = (await db.doc(`sessions/${roomId}`).get()).get('joinCode'), people = [];
  for (let group = 1; group <= 6; group++) {
    const c = await client(); await c.post('/rooms/join', { code }).expect(200);
    await h.post(`/rooms/${roomId}/groups/assign`, { uid: c.uid, group }).expect(200);
    const [id] = await register(c, roomId, [`班${group}の声`]); people.push({ c, id, group });
  }
  await begin(h, roomId);
  const runs = await Promise.all(people.map(async ({ c }) => (await start(c, roomId).expect(201)).body.runId));
  let release!: () => void;
  barrier = new Promise<void>((resolve) => { release = resolve; });
  const sends = people.map(({ c }, i) => chunk(c, roomId, runs[i]).expect(200).then((r) => r));
  try { await expect.poll(() => entered, { timeout: 5000 }).toBe(6); } finally { release(); }
  await Promise.all(sends); barrier = undefined;
  for (const { id, group } of people) {
    const state = await db.doc(`sessions/${roomId}/speaking/${group}`).get();
    expect(state.get('processedMs')).toBe(1000); expect(state.get('talkMs')).toEqual({ [id]: 1000 });
  }
}, 15_000);
// 実モデルは明示指定で実行。通常CIは実モデル成功と取り違えない。
const actual = process.env.T167_REAL_SPEAKER === '1';
let worker: SpeakerWorker | undefined;
afterAll(() => worker?.close());
it.skipIf(!actual)('実Sherpaモデル：登録に使っていない2種類の合成音声をAPI経由で識別し、無音を除外する', async () => {
  worker = new SpeakerWorker(process.env.SPEAKER_PYTHON!, fileURLToPath(new URL('../../../speech/worker.py', import.meta.url)));
  const realVoice: VoiceProvider = { version: 'sherpa-speaker-v1', source: 'model', extract: (pcm) => worker!.analyze(pcm) };
  const target = createApp({ ...deps, voice: realVoice });
  const paths = process.env.SPEAKER_TEST_VOICES!.split(',');
  const waves = paths.map((p) => {
    const b = readFileSync(p); let at = 12;
    expect(b.toString('ascii', 0, 4)).toBe('RIFF'); expect(b.toString('ascii', 8, 12)).toBe('WAVE');
    while (at < b.length) {
      const size = b.readUInt32LE(at + 4), type = b.toString('ascii', at, at + 4);
      if (type === 'fmt ') { expect(b.readUInt16LE(at + 8)).toBe(1); expect(b.readUInt16LE(at + 10)).toBe(1); expect(b.readUInt32LE(at + 12)).toBe(16000); expect(b.readUInt16LE(at + 22)).toBe(16); }
      if (type === 'data') { expect(size).toBeGreaterThanOrEqual(9 * 32000); return b.subarray(at + 8, at + 8 + size); }
      at += 8 + size + size % 2;
    }
    throw new Error('missing_pcm_data');
  });
  const { h, p, roomId, ids } = await setup(target, waves.map((b) => b.subarray(0, 8 * 32000)));
  expect((await db.collection(`sessions/${roomId}/voiceProfiles`).get()).docs[0].get('embedding')).toHaveLength(192);
  await begin(h, roomId); const run = (await start(p, roomId).expect(201)).body.runId;
  const report = [];
  for (const [i, wave] of waves.entries()) {
    now += 1000; await chunk(p, roomId, run, i, wave.subarray(8 * 32000, 9 * 32000)).expect(200);
    const state = (await stateRef(roomId).get()).data()!;
    expect(state.latest.uid).toBe(ids[i]); expect(state.latest.confidence).toBeGreaterThan(0.5);
    report.push({ voice: i + 1, confidence: state.latest.confidence, speechMs: state.talkMs[ids[i]] });
  }
  now += 1000; await chunk(p, roomId, run, 2, Buffer.alloc(32000)).expect(200);
  const final = (await stateRef(roomId).get()).data()!;
  expect(final.latest).toBeNull(); expect(final.processedMs).toBe(3000); expect(final.unknownMs).toBe(0);
  console.log(JSON.stringify({ actualModel: 'CAM++ / Silero VAD', syntheticVoices: report, silenceExcluded: true }));
  await h.post(`/rooms/${roomId}/finish`).expect(200);
  expect((await db.collection(`sessions/${roomId}/voiceProfiles`).get()).empty).toBe(true);
}, 30_000);
