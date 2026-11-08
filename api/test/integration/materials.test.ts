import { beforeEach, expect, it } from 'vitest';
import request from 'supertest';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { emulatorGoogleUser } from '../../../firebase/emulator-auth.mjs';
import { createApp } from '../../src/app.js';
import { mockGemini } from '../../src/gemini.js';
const projectId = process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId?.startsWith('demo-')) throw new Error('ローカル試験専用');
initializeApp({ projectId }); const db = getFirestore(), auth = getAuth();
const app = createApp({ db, auth, gemini: mockGemini() });
const id = 'a'.repeat(64), pdf = Buffer.from('%PDF-1.4\nsynthetic test fixture\n%%EOF');
let roomId: string;
beforeEach(() => { roomId = `material-${randomUUID()}`; });
async function user(member = true) {
  const u = await emulatorGoogleUser('student', `material-${randomUUID()}`);
  const response = await request(app).post('/sessions').set('authorization', `Bearer ${u.idToken}`).send({ deviceLabel: '試験端末', deviceType: 'tablet' }).expect(201);
  const headers = { authorization: `Bearer ${u.idToken}`, cookie: response.headers['set-cookie'][0].split(';')[0] };
  if (member) { await db.doc(`sessions/${roomId}`).set({ phase: 'collecting' }); await db.doc(`sessions/${roomId}/members/${u.localId}`).set({ role: 'participant', status: 'active' }); }
  return { headers, uid: u.localId };
}
async function material() {
  const ref = db.doc(`sessions/${roomId}/materials/${id}`);
  await ref.set({ name: '授業資料.pdf', bytes: pdf.length, chunks: 1 }); await ref.collection('chunks').doc('0').set({ data: pdf }); return ref;
}
it('本人の参加セッションだけが資料一覧とPDFを読め、一覧に本文を混ぜない', async () => {
  const own = await user(), outside = await user(false); await material();
  const path = `/rooms/${roomId}/materials`;
  await request(app).get(path).expect(401); await request(app).get(path).set(outside.headers).expect(403);
  const list = await request(app).get(path).set(own.headers).expect(200);
  expect(list.body.files).toEqual([{ id, name: '授業資料.pdf', kind: 'pdf', bytes: pdf.length }]);
  const content = await request(app).get(`${path}/${id}/content`).set(own.headers).expect(200);
  expect(content.headers['content-type']).toContain('application/pdf'); expect(content.headers['cache-control']).toBe('no-store');
  expect(content.body).toEqual(pdf);
  await db.doc(`sessions/${roomId}/members/${own.uid}`).update({ status: 'inactive' });
  await request(app).get(`${path}/${id}/content`).set(own.headers).expect(403);
});
it('不正なID、解除済み、壊れた資料を返さない', async () => {
  const own = await user(), path = `/rooms/${roomId}/materials`;
  await request(app).get(`${path}/invalid/content`).set(own.headers).expect(400);
  await request(app).get(`${path}/${id}/content`).set(own.headers).expect(404);
  const ref = await material(); await ref.collection('chunks').doc('0').delete();
  await request(app).get(`${path}/${id}/content`).set(own.headers).expect(502);
  await ref.collection('chunks').doc('0').set({ data: Buffer.from('not pdf') });
  await request(app).get(`${path}/${id}/content`).set(own.headers).expect(502);
});
