import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { emulatorGoogleUser } from '../../../firebase/emulator-auth.mjs';
import { createApp } from '../../src/app.js';
import { mockGemini } from '../../src/gemini.js';

// R1：テーマを非公開にした議論で、テーマ本文がセッション名（title）経由で参加者へ届かないこと。
// 実際の認証（エミュレータ）・API・SSE を通す。DB は検査専用のエミュレータだけを使う。
const projectId = process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId?.startsWith('demo-') || !/^(localhost|127\.0\.0\.1):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) throw new Error('専用エミュレータが必要です');
initializeApp({ projectId });
const db = getFirestore(), auth = getAuth(), app = createApp({ db, auth, gemini: mockGemini() });

const SECRET = '架空の非公開テーマ：端末を持たない人の参加をどう保障するか';  // submit-allow: テスト用のダミー
const NAME = '架空の授業 第2回';

async function client(kind: 'teacher' | 'student' = 'student') {
  const account = await emulatorGoogleUser(kind, `theme-${randomUUID()}`);
  const login = await request(app).post('/sessions').set('authorization', `Bearer ${account.idToken}`).send({ deviceLabel: '架空の端末', deviceType: 'pc' }).expect(201);
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  return {
    uid: account.localId, token: account.idToken, cookie,
    post: (path: string, body = {}) => request(app).post(path).set('authorization', `Bearer ${account.idToken}`).set('cookie', cookie).send(body),
    get: (path: string) => request(app).get(path).set('authorization', `Bearer ${account.idToken}`).set('cookie', cookie),
  };
}
type Client = Awaited<ReturnType<typeof client>>;

/** 1回の SSE 接続。最初の部屋の文書が届くまで読み、受け取った本文を返す */
async function liveRoom(c: Client, roomId: string) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const port = (server.address() as { port: number }).port, controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/rooms/${roomId}/live`, { headers: { authorization: `Bearer ${c.token}`, cookie: c.cookie }, signal: controller.signal });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader(), decoder = new TextDecoder();
    let text = '';
    while (!text.includes(`"sessions/${roomId}":{`)) { const part = await reader.read(); if (part.done) break; text += decoder.decode(part.value); }
    expect(text, '部屋の文書の配信').toContain(`"sessions/${roomId}":{`);
    await reader.cancel().catch(() => {});
    const room = text.split('\n\n').filter((b) => b.startsWith('data: ')).map((b) => JSON.parse(b.slice(6)).docs?.[`sessions/${roomId}`]).filter(Boolean).at(-1) as Record<string, unknown>;
    return { text, room };
  } finally {
    clearTimeout(timeout); controller.abort(); server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function setup() {
  const h = await client('teacher'), p = await client();
  const { roomId, joinCode } = (await h.post('/rooms', { title: NAME, theme: '公開中のテーマ', flowVersion: 1 }).expect(201)).body as { roomId: string; joinCode: string };
  await p.post('/rooms/join', { code: joinCode }).expect(200);
  const showTheme = (theme: boolean) => h.post(`/rooms/${roomId}/settings`, { participantView: { theme, timer: true, members: true } }).expect(200);
  return { h, p, roomId, showTheme };
}

describe('テーマ非公開時のセッション名（R1）', () => {
  it('テーマと別の名前の部屋は、テーマを保存しても参加者の一覧・SSE・再接続に本文を出さない。Host には見える', async () => {
    const { h, p, roomId, showTheme } = await setup();
    await showTheme(false);
    await h.post(`/rooms/${roomId}/settings`, { theme: SECRET }).expect(200);
    expect((await db.doc(`sessions/${roomId}`).get()).data()).toMatchObject({ title: NAME, theme: SECRET });

    for (let i = 0; i < 2; i++) { // 2回目は再接続
      const { text, room } = await liveRoom(p, roomId);
      expect(text).not.toContain(SECRET);
      expect(room).toMatchObject({ title: NAME, theme: '' });
    }
    const mine = (await p.get('/discussions').expect(200)).body.sessions.find((s: { sessionId: string }) => s.sessionId === roomId);
    expect(mine).toMatchObject({ title: NAME, theme: '', role: 'participant' });
    expect(JSON.stringify(mine)).not.toContain(SECRET);

    const host = await liveRoom(h, roomId);
    expect(host.room).toMatchObject({ title: NAME, theme: SECRET });
    expect((await h.get('/discussions').expect(200)).body.sessions).toContainEqual(expect.objectContaining({ sessionId: roomId, title: NAME, theme: SECRET, role: 'host' }));
  });

  it('名前にテーマが入った部屋（作成画面の既定）も、非公開→公開→再非公開で参加者に本文を出さない', async () => {
    const { h, p, roomId, showTheme } = await setup();
    await db.doc(`sessions/${roomId}`).update({ title: SECRET.slice(0, 100), theme: SECRET });
    await showTheme(false);
    let live = await liveRoom(p, roomId);
    expect(live.text).not.toContain(SECRET.slice(0, 20));
    expect(live.room).toMatchObject({ title: '話し合い', theme: '' });
    const listed = (await p.get('/discussions').expect(200)).body;
    expect(JSON.stringify(listed)).not.toContain(SECRET.slice(0, 20));

    await showTheme(true);
    live = await liveRoom(p, roomId);
    expect(live.room).toMatchObject({ theme: SECRET });

    await showTheme(false);
    live = await liveRoom(p, roomId);
    expect(live.text).not.toContain(SECRET.slice(0, 20));
    expect((await liveRoom(h, roomId)).room).toMatchObject({ title: SECRET.slice(0, 100), theme: SECRET });
  });
});
