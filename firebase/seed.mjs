// エミュレータに共有テストデータを入れる（本物のプロジェクトには接続しない）
// 使い方: エミュレータ起動中に npm --prefix firebase run seed
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT ?? 'demo-t167' });
const auth = getAuth();
const db = getFirestore();

const users = [
  { uid: 'mod', email: 'mod@example.com', password: 'password', role: 'moderator' }, // submit-allow: エミュレータ専用のダミー
  { uid: 'p1', email: 'p1@example.com', password: 'password', role: 'participant' }, // submit-allow: エミュレータ専用のダミー
  { uid: 'p2', email: 'p2@example.com', password: 'password', role: 'participant' }, // submit-allow: エミュレータ専用のダミー
  { uid: 'p3', email: 'p3@example.com', password: 'password', role: 'participant' }, // submit-allow: エミュレータ専用のダミー
];
for (const u of users) {
  await auth.createUser({ uid: u.uid, email: u.email, password: u.password }).catch((e) => {
    if (e.code !== 'auth/uid-already-exists') throw e;
  });
}
await db.doc('rooms/demo').set({ title: '大学における生成AI利用の是非', phase: 'collecting', createdBy: 'mod', createdAt: FieldValue.serverTimestamp(), analysis: { status: 'idle' } });
await db.doc('joinCodes/DEMO01').set({ roomId: 'demo' });
for (const u of users) await db.doc(`rooms/demo/members/${u.uid}`).set({ role: u.role, joinedAt: FieldValue.serverTimestamp() });
console.log('seeded: room=demo joinCode=DEMO01 users=mod/p1/p2/p3 (password: password)');
