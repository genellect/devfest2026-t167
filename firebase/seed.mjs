// エミュレータに共有テストデータを入れる（本物のプロジェクトには接続しない）
// 使い方: エミュレータ起動中に npm --prefix firebase run seed
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

import { emulatorGoogleUser } from './emulator-auth.mjs';
import { seedDashboardDemo } from './dashboard-demo.mjs';
for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key] ?? '')) throw new Error(`${key}に専用エミュレータを指定してください`);
}
initializeApp({ projectId: 'demo-t167' });
const db = getFirestore();
const teacher = await emulatorGoogleUser('teacher');
const student = await emulatorGoogleUser('student');
await db.doc('sessions/demo').set({ title: '大学における生成AI利用の是非', phase: 'collecting', createdBy: teacher.localId, groups: 1, createdAt: FieldValue.serverTimestamp(), schemaVersion: 3, theme: '大学における生成AI利用の是非', minutes: 15, resultsPublished: false, analysis: { status: 'idle' } });
await db.doc('joinCodes/100001').set({ roomId: 'demo' });
for (const [uid, role] of [[teacher.localId, 'host'], [student.localId, 'participant']]) {
  await db.doc(`sessions/demo/members/${uid}`).set({ uid, status: 'active', groupId: role === 'host' ? null : '1', role, ...(role === 'participant' ? { group: 1 } : {}), joinedAt: FieldValue.serverTimestamp() });
}
console.log('seeded: demo/100001（模擬Google教師・生徒、教師権限は管理側で付与）');

await seedDashboardDemo();
console.log('dashboard-demo/100002（3グループのUI確認用デモ）');
