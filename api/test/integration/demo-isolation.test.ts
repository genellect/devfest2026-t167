import { expect, it } from 'vitest';
import request from 'supertest';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { emulatorGoogleUser } from '../../../firebase/emulator-auth.mjs';
import { createApp } from '../../src/app.js';
import { mockGemini } from '../../src/gemini.js';
import { demoFirestore } from '../../src/demo-firestore.js';
const projectId = process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId?.startsWith('demo-')) throw new Error('専用エミュレータだけで実行します');
initializeApp({ projectId }); const db = getFirestore(), auth = getAuth();
const a = demoFirestore(db, 'pr34-a'), b = demoFirestore(db, 'pr34-b');
const first = createApp({ db: a, auth, gemini: mockGemini() }), second = createApp({ db: b, auth, gemini: mockGemini() });
async function login(app: ReturnType<typeof createApp>, token: string) {
  const r = await request(app).post('/sessions').set('authorization', `Bearer ${token}`).send({ deviceLabel: 'デモ', deviceType: 'pc' }).expect(201);
  return { authorization: `Bearer ${token}`, cookie: r.headers['set-cookie'][0].split(';')[0] };
}
it('同じGoogle利用者でも本番領域と別デモのログイン・議論・一覧を混ぜない', async () => {
  const u = await emulatorGoogleUser('teacher', `isolation-${randomUUID()}`), h1 = await login(first, u.idToken), h2 = await login(second, u.idToken);
  const create = await request(first).post('/rooms').set(h1).send({ title: 'デモAだけのセッション' }).expect(201);
  const { roomId } = create.body;
  const list = await request(first).get('/discussions').set(h1).expect(200);
  expect(list.body.sessions.map((s: { sessionId: string }) => s.sessionId)).toContain(roomId);
  expect((await request(second).get('/discussions').set(h2).expect(200)).body.sessions).toEqual([]);
  await request(second).get(`/rooms/${roomId}/me`).set(h2).expect(403);
  await request(first).get('/sessions/current').set(h1).expect(200);
  expect((await db.doc(`sessions/${roomId}`).get()).exists).toBe(false);
  expect((await a.doc(`sessions/${roomId}`).get()).exists).toBe(true);
  expect((await db.doc(`users/${u.localId}`).get()).exists).toBe(false);
});
it('デモのライブ結果を論理パスで配信し、Firestoreの保存ルートを画面へ混ぜない', async () => {
  const host = await emulatorGoogleUser('teacher', `demo-host-${randomUUID()}`), guest = await emulatorGoogleUser('student', `demo-guest-${randomUUID()}`);
  const h = await login(first, host.idToken), g = await login(first, guest.idToken);
  const room = (await request(first).post('/rooms').set(h).send({ title: '配信確認', groups: 1 }).expect(201)).body;
  await request(first).post('/rooms/join').set(g).send({ code: room.joinCode }).expect(200);
  // 話者の集計は、議論の終了後に結果を公開したときだけ学生へ届く（本人の分だけに絞った形）
  await a.doc(`sessions/${room.roomId}`).update({ resultsPublished: true, participantView: { speaking: true }, endedAt: new Date(), phase: 'closed' });
  await a.doc(`sessions/${room.roomId}/results/group-1`).set({ label: 'DEMO-RESULT' });
  await a.doc(`sessions/${room.roomId}/speaking/1`).set({ label: 'DEMO-SPEAKING' });
  const server = first.listen(0, '127.0.0.1'); await new Promise<void>((r) => server.once('listening', r));
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/rooms/${room.roomId}/live`, { headers: g, signal: controller.signal });
    const reader = response.body!.getReader(); let text = '';
    while (!text.includes('DEMO-RESULT') || !text.includes('"scope":"self"')) { const { value, done } = await reader.read(); if (done) break; text += new TextDecoder().decode(value); }
    expect(text).toContain(`sessions/${room.roomId}/speaking/1`); expect(text).not.toContain('demoEnvironments/');
  } finally { clearTimeout(timer); controller.abort(); server.closeAllConnections(); await new Promise<void>((r) => server.close(() => r())); }
});
