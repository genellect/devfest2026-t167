import { readFileSync } from 'node:fs';
import { test, before, after, beforeEach } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, collection, getDocs, query, where, serverTimestamp, addDoc } from 'firebase/firestore';

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-t167',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
after(async () => { await env.cleanup(); });

async function seed(phase) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [room, ph] of [['roomA', phase], ['roomB', phase]]) {
      await setDoc(doc(db, `rooms/${room}`), { title: room, phase: ph });
    }
    await setDoc(doc(db, 'rooms/roomA/members/mod'), { role: 'moderator' });
    await setDoc(doc(db, 'rooms/roomA/members/alice'), { role: 'participant' });
    await setDoc(doc(db, 'rooms/roomA/members/bob'), { role: 'participant' });
    await setDoc(doc(db, 'rooms/roomB/members/carol'), { role: 'participant' });
    await setDoc(doc(db, 'rooms/roomA/privateOpinions/alice'), { text: 'alice secret', updatedAt: new Date() });
    await setDoc(doc(db, 'rooms/roomA/insights/i1'), { status: 'pending', text: 'x' });
    await setDoc(doc(db, 'rooms/roomA/insights/i2'), { status: 'approved', text: 'y' });
    await setDoc(doc(db, 'joinCodes/ABC123'), { roomId: 'roomA' });
  });
}
const as = (uid) => env.authenticatedContext(uid).firestore();

test('本人は自分の非公開意見を読める', async () => {
  await seed('collecting');
  await assertSucceeds(getDoc(doc(as('alice'), 'rooms/roomA/privateOpinions/alice')));
});
test('他の参加者は他人の非公開意見を読めない', async () => {
  await seed('collecting');
  await assertFails(getDoc(doc(as('bob'), 'rooms/roomA/privateOpinions/alice')));
});
test('司会者も非公開意見を読めない', async () => {
  await seed('collecting');
  await assertFails(getDoc(doc(as('mod'), 'rooms/roomA/privateOpinions/alice')));
});
test('別室のメンバーは部屋を読めない', async () => {
  await seed('collecting');
  await assertFails(getDoc(doc(as('carol'), 'rooms/roomA')));
  await assertFails(getDocs(collection(as('carol'), 'rooms/roomA/messages')));
});
test('未ログインは何も読めない', async () => {
  await seed('collecting');
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'rooms/roomA')));
});
test('参加コードはクライアントから読めない', async () => {
  await seed('collecting');
  await assertFails(getDoc(doc(as('alice'), 'joinCodes/ABC123')));
});
test('クライアントは自分を司会者にできない', async () => {
  await seed('collecting');
  await assertFails(setDoc(doc(as('alice'), 'rooms/roomA/members/alice'), { role: 'moderator' }));
});
test('収集フェーズ中は自分の意見を書ける・他人名義は不可', async () => {
  await seed('collecting');
  await assertSucceeds(setDoc(doc(as('bob'), 'rooms/roomA/privateOpinions/bob'), { text: 'bob', updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(as('bob'), 'rooms/roomA/privateOpinions/alice'), { text: 'x', updatedAt: serverTimestamp() }));
});
test('収集フェーズ以外は意見を書けない', async () => {
  await seed('discussing');
  await assertFails(setDoc(doc(as('bob'), 'rooms/roomA/privateOpinions/bob'), { text: 'late', updatedAt: serverTimestamp() }));
});
test('発言は自分名義のみ・議論フェーズのみ', async () => {
  await seed('discussing');
  await assertSucceeds(addDoc(collection(as('bob'), 'rooms/roomA/messages'), { uid: 'bob', text: 'hi', createdAt: serverTimestamp() }));
  await assertFails(addDoc(collection(as('bob'), 'rooms/roomA/messages'), { uid: 'alice', text: 'spoof', createdAt: serverTimestamp() }));
  await assertFails(addDoc(collection(as('carol'), 'rooms/roomA/messages'), { uid: 'carol', text: 'intruder', createdAt: serverTimestamp() }));
});
test('参加者は承認済みの提案だけ読める', async () => {
  await seed('discussing');
  await assertSucceeds(getDocs(query(collection(as('alice'), 'rooms/roomA/insights'), where('status', '==', 'approved'))));
  await assertFails(getDoc(doc(as('alice'), 'rooms/roomA/insights/i1')));
  await assertSucceeds(getDoc(doc(as('mod'), 'rooms/roomA/insights/i1')));
});
test('合意の一文は合意フェーズで本人のみ', async () => {
  await seed('consensus');
  await assertSucceeds(setDoc(doc(as('alice'), 'rooms/roomA/consensusStatements/alice'), { text: '申告すれば利用可', agreement: 4, updatedAt: serverTimestamp() }));
  await assertFails(getDoc(doc(as('bob'), 'rooms/roomA/consensusStatements/alice')));
  await assertFails(setDoc(doc(as('bob'), 'rooms/roomA/consensusStatements/bob'), { text: 'x', agreement: 9, updatedAt: serverTimestamp() }));
});
test('懸念は文字列300字以内なら書ける・それ以外は拒否', async () => {
  await seed('consensus');
  const ref = doc(as('bob'), 'rooms/roomA/consensusStatements/bob');
  await assertSucceeds(setDoc(ref, { text: 'x', agreement: 3, concern: '費用が心配', updatedAt: serverTimestamp() }));
  await assertFails(setDoc(ref, { text: 'x', agreement: 3, concern: 'あ'.repeat(301), updatedAt: serverTimestamp() }));
  await assertFails(setDoc(ref, { text: 'x', agreement: 3, concern: { big: 'object' }, updatedAt: serverTimestamp() }));
});

test('グループの結果は、そのグループのメンバーと先生だけが読める', async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'rooms/roomA'), { title: 'A', phase: 'collecting', groups: 2 });
    await setDoc(doc(db, 'rooms/roomA/members/mod'), { role: 'moderator' });
    await setDoc(doc(db, 'rooms/roomA/members/alice'), { role: 'participant', group: 1 });
    await setDoc(doc(db, 'rooms/roomA/members/bob'), { role: 'participant', group: 2 });
    for (const id of ['group-1', 'flow-g1', 'summary']) await setDoc(doc(db, `rooms/roomA/results/${id}`), { x: 1 });
  });
  await assertSucceeds(getDoc(doc(as('alice'), 'rooms/roomA/results/group-1')));
  await assertSucceeds(getDoc(doc(as('alice'), 'rooms/roomA/results/flow-g1')));
  await assertFails(getDoc(doc(as('bob'), 'rooms/roomA/results/group-1')));
  await assertFails(getDoc(doc(as('bob'), 'rooms/roomA/results/flow-g1')));
  await assertSucceeds(getDoc(doc(as('bob'), 'rooms/roomA/results/summary')));
  await assertSucceeds(getDocs(collection(as('mod'), 'rooms/roomA/results')));
  await assertFails(getDocs(collection(as('alice'), 'rooms/roomA/results')));
  await assertFails(getDoc(doc(as('carol'), 'rooms/roomA/results/summary')));
});
