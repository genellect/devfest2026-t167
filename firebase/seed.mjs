// エミュレータに共有テストデータを入れる（本物のプロジェクトには接続しない）
// 使い方: エミュレータ起動中に npm --prefix firebase run seed
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

import { emulatorGoogleUser } from './emulator-auth.mjs';
for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key] ?? '')) throw new Error(`${key}に専用エミュレータを指定してください`);
}
initializeApp({ projectId: 'demo-t167' });
const db = getFirestore();
const teacher = await emulatorGoogleUser('teacher');
const student = await emulatorGoogleUser('student');
await db.doc('rooms/demo').set({ title: '大学における生成AI利用の是非', phase: 'collecting', createdBy: teacher.localId, groups: 1, createdAt: FieldValue.serverTimestamp(), analysis: { status: 'idle' } });
await db.doc('joinCodes/DEMO01').set({ roomId: 'demo' });
for (const [uid, role] of [[teacher.localId, 'moderator'], [student.localId, 'participant']]) {
  await db.doc(`rooms/demo/members/${uid}`).set({ role, ...(role === 'participant' ? { group: 1 } : {}), joinedAt: FieldValue.serverTimestamp() });
}
console.log('seeded: demo/DEMO01（模擬Google教師・生徒、教師権限は管理側で付与）');
