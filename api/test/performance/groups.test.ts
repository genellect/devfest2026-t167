/** 専用エミュレータでの再現可能な負荷試験。実Firestoreの遅延や費用を表すものではない。 */
import { expect, it } from 'vitest';
import request from 'supertest';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { emulatorGoogleUser } from '../../../firebase/emulator-auth.mjs';
import { createApp } from '../../src/app.js';
import { mockGemini } from '../../src/gemini.js';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

it('30人・6グループが同時に事前意見を提出しても欠落や5xxを生じない', async () => {
  for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key] ?? '')) throw new Error('専用エミュレータが必要です');
  }
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId?.startsWith('demo-')) throw new Error('デモ用プロジェクトが必要です');
  initializeApp({ projectId }); const db = getFirestore();
  const app = createApp({ db, auth: getAuth(), gemini: mockGemini() });
  const students = [];
  for (let i = 0; i < 30; i++) students.push(await emulatorGoogleUser('student', `load-${randomUUID()}`));
  const cookies = new Map<string, string>();
  for (const student of students) {
    const login = await request(app).post('/sessions').set('authorization', `Bearer ${student.idToken}`).send({ deviceLabel: 'load-test', deviceType: 'pc' }).expect(201);
    cookies.set(student.idToken, login.headers['set-cookie'][0].split(';')[0]);
  }
  const timings: number[] = [];
  for (let round = 0; round < 3; round++) {
    const room = db.collection('rooms').doc();
    await room.set({ schemaVersion: 2, title: '架空の負荷試験', groups: 6, phase: 'collecting' });
    const batch = db.batch();
    students.forEach((student, index) => batch.set(room.collection('members').doc(student.localId), { role: 'participant', group: Math.floor(index / 5) + 1 }));
    await batch.commit();
    const responses = await Promise.all(students.map(async (student, index) => {
      const started = performance.now();
      const response = await request(app).post(`/rooms/${room.id}/opinion`).set('authorization', `Bearer ${student.idToken}`).set('cookie', cookies.get(student.idToken)!).send({ text: `架空の意見${index}` });
      timings.push(performance.now() - started); return response;
    }));
    expect(responses.map((r) => r.status)).toEqual(Array(30).fill(200));
    expect((await room.collection('privateOpinions').get()).size).toBe(30);
    const state = (await room.get()).get('groupState');
    for (let group = 1; group <= 6; group++) expect(state[group]).toMatchObject({ status: 'discussing', total: 5, opinions: 5 });
  }
  timings.sort((a, b) => a - b);
  const p95Ms = Math.round(timings[Math.ceil(timings.length * 0.95) - 1]);
  const measurement = { event: 'local_load_test', students: 30, groups: 6, rounds: 3, requests: timings.length, p50Ms: Math.round(timings[Math.floor(timings.length / 2)]), p95Ms, targetP95Ms: 1000, targetMet: p95Ms < 1000 };
  mkdirSync('coverage', { recursive: true });
  writeFileSync('coverage/local-load.json', JSON.stringify(measurement, null, 2));
  console.info(JSON.stringify(measurement));
  expect(p95Ms, "専用エミュレータ上のp95目標").toBeLessThan(1000);
}, 120_000);
