import { expect, it, beforeEach } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { emulatorGoogleUser } from '../../../firebase/emulator-auth.mjs';
import { createApp } from '../../src/app.js';
import { mockGemini } from '../../src/gemini.js';
import type { Drive } from '../../src/drive.js';
const projectId = process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId?.startsWith('demo-')) throw new Error('デモ専用');
initializeApp({ projectId }); const db = getFirestore(), auth = getAuth();
let googleSub = '', materialCalls = 0, large = false;
const drive: Drive = {
  identity: async () => googleSub,
  material: async () => { materialCalls++; return { name: '教材', originalMimeType: 'application/vnd.google-apps.document', pdf: large ? Buffer.alloc(4 * 1024 * 1024, 1) : Buffer.from('%PDF-1.7\nsample') }; },
};
const app = createApp({ db, auth, gemini: mockGemini(), drive });
beforeEach(() => { materialCalls = 0; large = false; });
async function client(kind: 'teacher' | 'student' = 'student') {
  const sub = `workspace-${randomUUID()}`, u = await emulatorGoogleUser(kind, sub);
  const s = await request(app).post('/sessions').set('authorization', `Bearer ${u.idToken}`).send({ deviceLabel: 'テスト', deviceType: 'pc' }).expect(201);
  const headers = { authorization: `Bearer ${u.idToken}`, cookie: s.headers['set-cookie'][0].split(';')[0], 'x-google-access-token': 'test-access-token' };
  return { sub, uid: u.localId, headers, get: (path: string) => { googleSub = sub; return request(app).get(path).set(headers); }, post: (path: string, body: object = {}) => { googleSub = sub; return request(app).post(path).set(headers).send(body); } };
}
async function setup() {
  const h = await client('teacher'), p = await client(), other = await client();
  const room = (await h.post('/rooms', { title: '資料試験', flowVersion: 1 }).expect(201)).body;
  await p.post('/rooms/join', { code: room.joinCode }).expect(200);
  return { h, p, other, id: room.roomId as string };
}
it('Google本人不一致・トークンなし・ログイン失効では資料追加できない', async () => {
  const { h, id } = await setup();
  const path = `/rooms/${id}/materials`, body = { fileId: 'file', shareCopy: true };
  googleSub = 'another-account';
  await request(app).post(path).set(h.headers).send(body).expect(403);
  await request(app).post(path).set({ authorization: h.headers.authorization, cookie: h.headers.cookie }).send(body).expect(409);
  await h.post(path, { fileId: '../file', shareCopy: true }).expect(400);
  await h.post(path, { fileId: 'file', shareCopy: false }).expect(400);
  expect(materialCalls).toBe(0);
  await h.post('/sessions/logout').expect(200);
  await h.post(path, body).expect(401);
});
it('Hostが明示した資料の写しだけを参加者が閲覧でき、未参加者や他セッションからは取得できない', async () => {
  const { h, p, other, id } = await setup();
  await p.post(`/rooms/${id}/materials`, { fileId: 'file', shareCopy: true }).expect(403); expect(materialCalls).toBe(0);
  await h.post(`/rooms/${id}/materials`, { fileId: 'file' }).expect(400);
  const file = (await h.post(`/rooms/${id}/materials`, { fileId: 'file', shareCopy: true }).expect(201)).body.file;
  const listing = (await p.get(`/rooms/${id}/materials`).expect(200)).body.files;
  expect(listing).toEqual([file]); expect(JSON.stringify(listing)).not.toContain('test-access-token');
  const content = await p.get(`/rooms/${id}/materials/${file.id}/content`).expect(200); expect(content.headers['content-type']).toContain('application/pdf'); expect(content.body.toString()).toContain('%PDF-');
  await other.get(`/rooms/${id}/materials/${file.id}/content`).expect(403);
  const second = (await h.post('/rooms', { title: '別の部屋' }).expect(201)).body;
  await h.get(`/rooms/${second.roomId}/materials/${file.id}/content`).expect(404);
  await h.post(`/rooms/${id}/materials`, { fileId: 'file', shareCopy: true }).expect(201);
  expect((await h.get(`/rooms/${id}/materials`).expect(200)).body.files).toHaveLength(1);
  await p.post(`/rooms/${id}/materials/${file.id}/remove`).expect(403);
  await h.post(`/rooms/${id}/materials/${file.id}/remove`).expect(200);
  await p.get(`/rooms/${id}/materials/${file.id}/content`).expect(404);
  expect((await db.collection(`sessions/${id}/materials/${file.id}/chunks`).get()).empty).toBe(true);
});
it('資料件数・容量を制限し、終了済みや除外されたメンバーには配布しない', async () => {
  const { h, p, id } = await setup();
  for (let i = 0; i < 5; i++) await h.post(`/rooms/${id}/materials`, { fileId: `file-${i}`, shareCopy: true }).expect(201);
  await h.post(`/rooms/${id}/materials`, { fileId: 'sixth', shareCopy: true }).expect(413);
  const file = (await h.get(`/rooms/${id}/materials`).expect(200)).body.files[0];
  await db.doc(`sessions/${id}/members/${p.uid}`).update({ status: 'inactive' });
  await p.get(`/rooms/${id}/materials/${file.id}/content`).expect(403);
  await db.doc(`sessions/${id}`).update({ phase: 'closed' });
  await h.post(`/rooms/${id}/materials`, { fileId: 'closed', shareCopy: true }).expect(409);
  const other = (await h.post('/rooms', { title: '容量', flowVersion: 1 }).expect(201)).body; large = true;
  await h.post(`/rooms/${other.roomId}/materials`, { fileId: 'large1', shareCopy: true }).expect(201);
  await h.post(`/rooms/${other.roomId}/materials`, { fileId: 'large2', shareCopy: true }).expect(201);
  await h.post(`/rooms/${other.roomId}/materials`, { fileId: 'large3', shareCopy: true }).expect(413);
});
