import { expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { emulatorGoogleUser } from '../../../firebase/emulator-auth.mjs';
import { createApp } from '../../src/app.js';
import { mockGemini } from '../../src/gemini.js';

const projectId = process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId?.startsWith('demo-')) throw new Error('デモプロジェクトだけで検査します');
initializeApp({ projectId });
let failing = false;
const db = getFirestore(), app = createApp({ db, auth: getAuth(), gemini: mockGemini({ fail: () => failing }) });
async function client(kind: 'teacher' | 'student') {
  const u = await emulatorGoogleUser(kind, `ideas-${randomUUID()}`);
  const login = await request(app).post('/sessions').set('authorization', `Bearer ${u.idToken}`).send({ deviceLabel: '架空の端末', deviceType: 'pc' }).expect(201);
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  return (body: object) => request(app).post('/themes/suggest').set('authorization', `Bearer ${u.idToken}`).set('cookie', cookie).send(body);
}

it('テーマ案は教員だけが出せる。3つの案を返し、「別の案」では前の案を避ける。依頼の本文は保存しない', async () => {
  const teacher = await client('teacher'), student = await client('student');
  await student({ request: '高校2年の情報' }).expect(403);
  await teacher({ request: '' }).expect(400);
  await teacher({ request: 'あ'.repeat(501) }).expect(400);
  const first = (await teacher({ request: '高校2年の情報。SNSの情報の見分け方' }).expect(200)).body;
  expect(first.themes).toHaveLength(3);
  expect(new Set(first.themes).size).toBe(3);
  const second = (await teacher({ request: '高校2年の情報。SNSの情報の見分け方', previous: first.themes }).expect(200)).body;
  expect(second.themes.some((t: string) => first.themes.includes(t))).toBe(false);
  // 回数の記録には利用者のハッシュと回数だけを残し、依頼の本文は残さない
  const stored = await db.collection('apiLimits').get();
  expect(JSON.stringify(stored.docs.map((d) => d.data()))).not.toContain('SNSの情報の見分け方');
});

it('テーマ案は1分に6回まで。Gemini が失敗したら 503 を返す', async () => {
  const teacher = await client('teacher');
  failing = true;
  const failed = await teacher({ request: '中学3年の社会' }).expect(503);
  expect(failed.body.error.code).toBe('theme_unavailable');
  failing = false;
  for (let i = 0; i < 5; i++) await teacher({ request: '中学3年の社会' }).expect(200);
  expect((await teacher({ request: '中学3年の社会' }).expect(429)).body.error.code).toBe('rate_limited');
});
