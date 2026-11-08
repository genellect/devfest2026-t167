import { expect, it, beforeEach } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { emulatorGoogleUser } from '../../../firebase/emulator-auth.mjs';
import { createApp } from '../../src/app.js';
import { mockGemini } from '../../src/gemini.js';
import { HttpError } from '../../src/http.js';
import { wireData } from '../../src/live-routes.js';
import type { Workspace, Course } from '../../src/workspace.js';
const projectId = process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId?.startsWith('demo-')) throw new Error('デモ専用');
initializeApp({ projectId }); const db = getFirestore(), auth = getAuth();
const roles = new Map<string, Course['role']>();
let archived = false, denied = false, providerCalls = 0, now = Date.now();
const roster: {id:string;name:string}[] = [];
const workspace: Workspace = {
  identity: async token => { providerCalls++; if (denied) throw new HttpError(403, 'google_permission', '学校の許可を確認してください'); return token; },
  courses: async token => archived ? [] : roles.has(token) ? [{ id: 'classroom-a', name: '探究学習', section: '1年1組', role: roles.get(token)! }] : [],
  roster: async () => roster,
  material: async () => { throw new Error('今回の範囲外'); },
};
const app = createApp({ db, auth, gemini: mockGemini(), workspace, now: () => now });
beforeEach(() => { archived = false; denied = false; providerCalls = 0; now = Date.now(); roster.splice(0); });
async function client(kind: 'teacher' | 'student' = 'student', role?: Course['role']) {
  const sub = `classroom-${randomUUID()}`, u = await emulatorGoogleUser(kind, sub);
  const s = await request(app).post('/sessions').set('authorization', `Bearer ${u.idToken}`).send({ deviceLabel: 'テスト', deviceType: 'pc' }).expect(201);
  if (role) roles.set(sub, role);
  const headers = { authorization: `Bearer ${u.idToken}`, cookie: s.headers['set-cookie'][0].split(';')[0], 'x-google-access-token': sub };
  return { sub, uid: u.localId, headers, get: (path: string) => request(app).get(path).set(headers), post: (path: string, body: object = {}) => request(app).post(path).set(headers).send(body) };
}
async function setup() {
  const h = await client('teacher', 'teacher'), p = await client('student', 'student');
  const r = (await h.post('/rooms', { title: 'クラスの議論', theme: 'テーマ', flowVersion: 1, classroomCourseId: 'classroom-a', className: '偽装名' }).expect(201)).body;
  roster.push({ id: p.sub, name: '生徒A' }, { id: 'not-joined', name: '生徒B' });
  return { h, p, roomId: r.roomId as string, code: r.joinCode as string };
}
it('追加同意の本人だけが所属クラスを取得でき、通常ログインのteacher claimを変更しない', async () => {
  const p = await client('student', 'teacher');
  expect((await p.get('/integrations/classroom/courses').expect(200)).body.courses[0].role).toBe('teacher');
  const created = await p.post('/rooms', { title: 'クラスの教師として作成', classroomCourseId: 'classroom-a' }).expect(201);
  expect((await db.doc(`sessions/${created.body.roomId}/members/${p.uid}`).get()).get('role')).toBe('host');
  expect((await auth.getUser(p.uid)).customClaims?.teacher).not.toBe(true);
});
it('Classroom教師所属を検証し、アプリの教師claimがあってもクラスの生徒は作成不可', async () => {
  const {h,p,roomId} = await setup();
  const room = await db.doc(`sessions/${roomId}`).get();
  expect(room.get('className')).toBe('探究学習・1年1組'); expect(room.get('classroomCourseName')).toBe('探究学習');
  roles.set(h.sub, 'student'); await h.post('/rooms', { title: '生徒クラス', classroomCourseId: 'classroom-a' }).expect(403);
  await p.get('/integrations/classroom/courses/classroom-a/roster').expect(403);
  await h.post('/rooms', { title: '未所属', classroomCourseId: 'unknown' }).expect(403);
  await h.post('/rooms', { title: '不正ID', classroomCourseId: '../x' }).expect(400);
});
it('名簿はClassroomの教師だけに返し、アプリ未利用者を参加済みにしない', async () => {
  const {h,p,roomId} = await setup();
  expect((await h.get('/integrations/classroom/courses/classroom-a/roster').expect(200)).body.students).toEqual(roster);
  const url = `/rooms/${roomId}/classroom/roster`;
  expect((await h.get(url).expect(200)).body.students.every((s:{joined:boolean})=>!s.joined)).toBe(true);
  expect((await db.doc(`sessions/${roomId}/members/${p.uid}`).get()).exists).toBe(false);
  await p.post('/rooms/join', { classroomRoomId: roomId }).expect(200);
  expect((await h.get(url).expect(200)).body.students.map((s:{joined:boolean})=>s.joined)).toEqual([true,false]);
  await p.get(url).expect(403);
  const other = await client('teacher','teacher'); await other.get(url).expect(403);
  roles.set(h.sub,'student'); await h.get(url).expect(403);
});
it('クラス所属者に開催中一覧だけを返し、参加コード・名簿・事前意見は漏らさない', async () => {
  const {p,roomId} = await setup();
  const r = await p.get('/integrations/classroom/courses/classroom-a/discussions').expect(200);
  const item = r.body.sessions.find((s:{roomId:string})=>s.roomId===roomId);
  expect(item).toMatchObject({joined:false,host:false}); expect(item.joinCode).toBeUndefined();
  await p.get(`/rooms/${roomId}/me`).expect(403);
  const outsider = await client(); await outsider.get('/integrations/classroom/courses/classroom-a/discussions').expect(403);
});
it('コード・QR・ホーム経由の新規参加すべてで所属を再検証し、本人だけを登録する', async () => {
  const {p,roomId,code} = await setup(); const outsider = await client();
  await outsider.post('/rooms/join',{code}).expect(403);
  await outsider.post('/rooms/join',{classroomRoomId:roomId}).expect(403);
  await request(app).post('/rooms/join').set({authorization:p.headers.authorization,cookie:p.headers.cookie}).send({code}).expect(409);
  await request(app).post('/rooms/join').set({...p.headers,'x-google-access-token':'different-account'}).send({code}).expect(403);
  await p.post('/rooms/join',{classroomRoomId:roomId}).expect(200);
  await p.post('/rooms/join',{code}).expect(200);
  const m = await db.doc(`sessions/${roomId}/members/${p.uid}`).get(); expect(m.get('classroomUserId')).toBe(p.sub);
  expect((await db.doc(`users/${p.uid}/discussions/${roomId}`).get()).exists).toBe(true);
});
it('退出扱いの利用者や開始済みの新規参加は拒否し、一覧からも除外する', async () => {
  const {p,roomId} = await setup();
  await db.doc(`sessions/${roomId}`).update({phase:'discussing'});
  await p.post('/rooms/join',{classroomRoomId:roomId}).expect(409);
  let r = await p.get('/integrations/classroom/courses/classroom-a/discussions').expect(200);
  expect(r.body.sessions.some((s:{roomId:string})=>s.roomId===roomId)).toBe(false);
  await db.doc(`sessions/${roomId}`).update({phase:'collecting'});
  await p.post('/rooms/join',{classroomRoomId:roomId}).expect(200);
  await db.doc(`sessions/${roomId}/members/${p.uid}`).update({status:'inactive'});
  await p.post('/rooms/join',{classroomRoomId:roomId}).expect(403);
  r = await p.get('/integrations/classroom/courses/classroom-a/discussions').expect(200);
  expect(r.body.sessions.some((s:{roomId:string})=>s.roomId===roomId)).toBe(false);
});
it('終了・期限切れ・アーカイブ・所属解除を最新の所属確認で処理する', async () => {
  const {p,roomId} = await setup();
  await db.doc(`sessions/${roomId}`).update({expiresAt:Timestamp.fromMillis(now-1)});
  expect((await p.get('/integrations/classroom/courses/classroom-a/discussions').expect(200)).body.sessions.some((s:{roomId:string})=>s.roomId===roomId)).toBe(false);
  await p.post('/rooms/join',{classroomRoomId:roomId}).expect(409);
  await db.doc(`sessions/${roomId}`).update({expiresAt:Timestamp.fromMillis(now+100000),phase:'closed'});
  expect((await p.get('/integrations/classroom/courses/classroom-a/discussions').expect(200)).body.sessions.some((s:{roomId:string})=>s.roomId===roomId)).toBe(false);
  archived=true; expect((await p.get('/integrations/classroom/courses').expect(200)).body.courses).toEqual([]);
  await p.get('/integrations/classroom/courses/classroom-a/discussions').expect(403);
  await p.post('/rooms/join',{classroomRoomId:roomId}).expect(403);
});
it('失効Cookie・学校の利用制限・欠落トークンを正しく返し、自動連携しない', async () => {
  const p = await client('student','student');
  await request(app).get('/integrations/classroom/courses').expect(401); expect(providerCalls).toBe(0);
  await request(app).get('/integrations/classroom/courses').set({authorization:p.headers.authorization,cookie:p.headers.cookie}).expect(409);
  denied=true; const error = await p.get('/integrations/classroom/courses').expect(403); expect(error.body.error.code).toBe('google_permission'); denied=false;
  await p.post('/sessions/logout').expect(200); providerCalls=0;
  await p.get('/integrations/classroom/courses').expect(401); expect(providerCalls).toBe(0);
});
it('通常のコード参加とClassroomなしの作成を維持し、任意roomId参加は許可しない', async () => {
  const h = await client('teacher'), p = await client();
  const r = (await h.post('/rooms',{title:'従来の議論',flowVersion:1}).expect(201)).body;
  await p.post('/rooms/join',{classroomRoomId:r.roomId}).expect(403);
  await p.post('/rooms/join',{code:r.joinCode}).expect(200);
  await h.get(`/rooms/${r.roomId}/classroom/roster`).expect(404);
  expect(providerCalls).toBe(0);
});
it('Classroom用の識別子はリアルタイム配信の文書・メンバー一覧に含めない', () => {
  expect(wireData({classroomUserId:'secret', members:[{classroomUserId:'secret',uid:'app-user'}]})).toEqual({members:[{uid:'app-user'}]});
});
