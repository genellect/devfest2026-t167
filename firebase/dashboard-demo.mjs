// 架空データだけを専用エミュレータに投入する。既存の利用者の部屋は変更しない。
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { emulatorGoogleUser } from './emulator-auth.mjs';

export const DASHBOARD_DEMO_ID = 'dashboard-demo';
export async function seedDashboardDemo() {
  for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key] ?? '')) throw new Error(`${key}に専用エミュレータを指定してください`);
  }
  const project = process.env.GOOGLE_CLOUD_PROJECT ?? 'demo-t167';
  const app = getApps()[0] ?? initializeApp({ projectId: project });
  if (!project.startsWith('demo-') || app.options.projectId !== project) throw new Error('デモ専用プロジェクトでのみ実行できます');
  const db = getFirestore(app), ref = db.doc(`sessions/${DASHBOARD_DEMO_ID}`);
  const [before, code] = await db.getAll(ref, db.doc('joinCodes/100002'));
  if ((before.exists && before.get('demoFixture') !== 'dashboard-v1') || (code.exists && code.get('roomId') !== DASHBOARD_DEMO_ID)) throw new Error('デモ以外のデータと重複しています');
  const teacher = await emulatorGoogleUser('teacher');
  if (before.exists) await db.recursiveDelete(ref);
  const now = Date.now(), startedAt = Timestamp.fromMillis(now - 10 * 60_000), batch = db.batch();
  const groupState = {};
  const names = [ ['あおい', 'はると', 'みお', 'そうた'], ['ひなた', 'ゆい', 'りく', 'さくら'], ['なな', 'かいと', 'めい', 'れん'] ];
  for (let g = 1; g <= 3; g++) {
    const people = names[g - 1].map((name, i) => ({ uid: `demo-g${g}-p${i + 1}`, label: `${name}（デモ）` }));
    const timeline = Array.from({ length: 10 }, (_, minute) => {
      const phase = minute % 3;
      const ms = g === 1 ? [12000 + phase * 500, 14000 - phase * 500, 13000, 13000]
        : g === 2 ? [40000 - phase * 1000, 7000 + phase * 500, 3000 + phase * 300, 2000 + phase * 200]
          : minute < 4 ? [26000, 16000, 6000, 4000] : minute < 7 ? [12000, 18000, 12000, 10000] : [7000, 10000, 17000, 18000];
      return { talkMs: Object.fromEntries(people.map((p, i) => [p.uid, ms[i]])), unknownMs: 3000 };
    });
    const talkMs = Object.fromEntries(people.map(p => [p.uid, timeline.reduce((sum, minute) => sum + minute.talkMs[p.uid], 0)]));
    batch.set(ref.collection('groups').doc(String(g)), { groupId: String(g), number: g, name: `グループ${g}`, recorderUid: people[0].uid, recorderName: people[0].label });
    for (const p of people) batch.set(ref.collection('members').doc(p.uid), { uid: p.uid, role: 'participant', status: 'active', groupId: String(g), group: g, displayName: p.label, mode: 'personal', ready: true, attendees: [{ id: p.uid, displayName: p.label, voiceRegistered: true }], joinedAt: startedAt });
    batch.set(ref.collection('speaking').doc(String(g)), { group: g, source: 'mock', processedMs: 600000, unknownMs: 30000, talkMs, members: people, timeline, latest: { uid: people[3].uid, label: people[3].label, confidence: null } });
    // 終了の操作後にも、架空の結果を確認できる。
    batch.set(ref.collection('results').doc(`group-${g}`), { group: g, respondents: 4, source: 'mock', alignmentRate: g === 2 ? .5 : .75, clusters: [{ label: '利用箇所を申告してAIを使う', count: g === 2 ? 2 : 3 }, { label: '教員の許可がある場合にAIを使う', count: g === 2 ? 2 : 1 }] });
    groupState[g] = { status: 'discussing', total: 4, opinions: 4, submitted: 0, startedAt };
  }
  batch.set(ref, { title: '3グループのダッシュボード（デモ）', theme: '学校でAIを使うとき、どんなルールが必要だろう？', className: 'UI確認用・架空のクラス', demoFixture: 'dashboard-v1', flowVersion: 1, schemaVersion: 3, phase: 'discussing', groups: 3, groupState, groupSelection: 'host', joinCode: '100002', createdBy: teacher.localId, createdAt: startedAt, startedAt, expiresAt: Timestamp.fromMillis(now + 3 * 60 * 60_000), recording: true, publishOnEnd: false, resultsPublished: false, participantView: { theme: true, timer: false, members: true, speaking: false }, analysis: { status: 'idle' } });
  batch.set(ref.collection('members').doc(teacher.localId), { uid: teacher.localId, role: 'host', status: 'active', groupId: null, joinedAt: startedAt });
  batch.set(db.doc(`users/${teacher.localId}/discussions/${DASHBOARD_DEMO_ID}`), { role: 'host', groupId: null, joinedAt: FieldValue.serverTimestamp() });
  batch.set(db.doc('joinCodes/100002'), { roomId: DASHBOARD_DEMO_ID });
  batch.set(ref.collection('results').doc('coverage'), { source: 'mock', total: 5, discussed: 3, reflectionRate: .6, points: [ { summary: '利用箇所を申告する方法', discussed: true }, { summary: '学習の目的とAIの役割', discussed: true }, { summary: '生成された情報の確かめ方', discussed: true }, { summary: '端末や利用環境の違いへの配慮', discussed: false }, { summary: 'AIを使わない場合の選択肢', discussed: false } ] });
  for (const [i, summary] of ['端末を持たない人も参加するには、どんな工夫ができるでしょうか？', 'AIを使わない選択をした人の学習機会も考えてみましょう。'].entries()) batch.set(ref.collection('insights').doc(`demo-pending-${i}`), { summary, status: 'pending', source: 'mock', createdAt: startedAt });
  batch.set(ref.collection('insights').doc('demo-approved'), { summary: 'AIを使った箇所を、相手にどう伝えますか？', status: 'approved', source: 'mock', createdAt: startedAt });
  await batch.commit();
  return DASHBOARD_DEMO_ID;
}
