import { readFileSync } from 'node:fs';
import { test, before, after, beforeEach } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, collection, getDocs, query, where, serverTimestamp, addDoc } from 'firebase/firestore';

let env;
before(async () => {
  const address = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(address)) throw new Error('Rulesの試験はローカルの専用エミュレータで実行してください');
  const [host, port] = address.split(':');
  env = await initializeTestEnvironment({
    projectId: process.env.GOOGLE_CLOUD_PROJECT ?? 'demo-t167',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host, port: Number(port) },
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
const as = (uid) => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'google.com' }, ...(uid === 'mod' ? { teacher: true } : {}) }).firestore();

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
test('グループの議論が始まったら意見を書けない', async () => {
  await seed('discussing');
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'rooms/roomA'), { groupState: { '1': { status: 'discussing' } } }, { merge: true });
  });
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

test('グループの結果は、そのグループのメンバーと先生だけが読める。クラス全体の結果は先生だけ', async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'rooms/roomA'), { title: 'A', phase: 'collecting', groups: 2 });
    await setDoc(doc(db, 'rooms/roomA/members/mod'), { role: 'moderator' });
    await setDoc(doc(db, 'rooms/roomA/members/alice'), { role: 'participant', group: 1 });
    await setDoc(doc(db, 'rooms/roomA/members/bob'), { role: 'participant', group: 2 });
    await setDoc(doc(db, 'rooms/roomA/members/dave'), { role: 'participant' }); // まだグループを選んでいない
    for (const id of ['group-1', 'flow-g1', 'summary', 'coverage']) await setDoc(doc(db, `rooms/roomA/results/${id}`), { x: 1 });
  });
  await assertSucceeds(getDoc(doc(as('alice'), 'rooms/roomA/results/group-1')));
  await assertSucceeds(getDoc(doc(as('alice'), 'rooms/roomA/results/flow-g1')));
  await assertFails(getDoc(doc(as('bob'), 'rooms/roomA/results/group-1')));
  await assertFails(getDoc(doc(as('bob'), 'rooms/roomA/results/flow-g1')));
  await assertFails(getDoc(doc(as('dave'), 'rooms/roomA/results/group-1')));
  await assertFails(getDoc(doc(as('alice'), 'rooms/roomA/results/summary')));
  await assertFails(getDoc(doc(as('alice'), 'rooms/roomA/results/coverage')));
  await assertSucceeds(getDoc(doc(as('mod'), 'rooms/roomA/results/summary')));
  await assertSucceeds(getDocs(collection(as('mod'), 'rooms/roomA/results')));
  await assertFails(getDocs(collection(as('alice'), 'rooms/roomA/results')));
  await assertFails(getDoc(doc(as('carol'), 'rooms/roomA/results/group-1')));
});

async function groupedSeed(phase = 'collecting', status = 'opinions') {
  await seed(phase);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'rooms/roomA'), { groups: 2, groupState: { '1': { status }, '2': { status: 'opinions' } } }, { merge: true });
    await setDoc(doc(db, 'rooms/roomA/members/alice'), { role: 'participant', group: 1 });
    await setDoc(doc(db, 'rooms/roomA/members/bob'), { role: 'participant', group: 2 });
    await setDoc(doc(db, 'rooms/roomA/members/dave'), { role: 'participant' });
  });
}

test('部屋がcollectingでも、議論開始済みのグループの意見は直接変更できない', async () => {
  await groupedSeed('collecting', 'discussing');
  await assertFails(setDoc(doc(as('alice'), 'rooms/roomA/privateOpinions/alice'), { text: '締切後の変更', updatedAt: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(as('bob'), 'rooms/roomA/privateOpinions/bob'), { text: '別グループは受付中', updatedAt: serverTimestamp() }));
});

test('部屋がdiscussingでも、自分のグループが受付中なら意見を書ける', async () => {
  await groupedSeed('discussing');
  await assertSucceeds(setDoc(doc(as('alice'), 'rooms/roomA/privateOpinions/alice'), { text: '受付中の意見', updatedAt: serverTimestamp() }));
});

test('部屋がcollectingでも、終了した自分のグループにだけ結論を書ける', async () => {
  await groupedSeed('collecting', 'consensus');
  const body = { text: '結論', agreement: 3, updatedAt: serverTimestamp() };
  await assertSucceeds(setDoc(doc(as('alice'), 'rooms/roomA/consensusStatements/alice'), body));
  await assertFails(setDoc(doc(as('bob'), 'rooms/roomA/consensusStatements/bob'), body));
  await assertFails(setDoc(doc(as('bob'), 'rooms/roomA/consensusStatements/alice'), body));
});

test('グループ未選択・存在しない番号・司会者は、生徒用の意見や結論を書けない', async () => {
  await groupedSeed('consensus');
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'rooms/roomA/members/outofrange'), { role: 'participant', group: 3 });
  });
  for (const uid of ['dave', 'outofrange', 'mod']) {
    await assertFails(setDoc(doc(as(uid), `rooms/roomA/privateOpinions/${uid}`), { text: '意見', updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(as(uid), `rooms/roomA/consensusStatements/${uid}`), { text: '結論', agreement: 3, updatedAt: serverTimestamp() }));
  }
});

test('closedでは、グループが受付中・合意中・完了済みでも書き込めない', async () => {
  for (const status of ['opinions', 'consensus', 'done']) {
    await groupedSeed('closed', status);
    await assertFails(setDoc(doc(as('alice'), 'rooms/roomA/privateOpinions/alice'), { text: '締切後', updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(as('alice'), 'rooms/roomA/consensusStatements/alice'), { text: '締切後', agreement: 3, updatedAt: serverTimestamp() }));
  }
});

test('匿名・パスワード認証は所属済みでも拒否し、教師権限を自己申告できない', async () => {
  await seed('collecting');
  for (const provider of ['anonymous', 'password']) {
    const db = env.authenticatedContext('alice', { firebase: { sign_in_provider: provider } }).firestore();
    await assertFails(getDoc(doc(db, 'rooms/roomA')));
    await assertFails(setDoc(doc(db, 'rooms/roomA/privateOpinions/alice'), { text: 'x', updatedAt: serverTimestamp() }));
  }
  const fakeTeacher = env.authenticatedContext('mod', { firebase: { sign_in_provider: 'google.com' } }).firestore();
  await assertFails(getDoc(doc(fakeTeacher, 'rooms/roomA/privateOpinions/alice')));
  await assertFails(getDoc(doc(fakeTeacher, 'rooms/roomA/results/summary')));
  await assertFails(setDoc(doc(as('alice'), 'apiLimits/anything'), { count: 0 }));
});
test('結果確定後の一文は書き換えられない（古い分析結果との食い違いを防ぐ）', async () => {
  await seed('consensus');
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'rooms/roomA'), { groupState: { 1: { status: 'done' } } }, { merge: true });
  });
  await assertFails(setDoc(doc(as('alice'), 'rooms/roomA/consensusStatements/alice'), { text: '変更', agreement: 3, updatedAt: serverTimestamp() }));
});
test('分析中とクラス結果確定後の一文変更も拒否する（APIとの対称性）', async () => {
  await seed('consensus');
  for (const patch of [
    { groupState: { 1: { status: 'consensus', analysis: { running: true } } } },
    { groupState: { 1: { status: 'consensus', analysis: { running: false } } }, consensusAnalysis: { status: 'running' } },
    { consensusAnalysis: { status: 'done' } },
  ]) {
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'rooms/roomA'), patch, { merge: true }); });
    await assertFails(setDoc(doc(as('alice'), 'rooms/roomA/consensusStatements/alice'), { text: '変更', agreement: 3, updatedAt: serverTimestamp() }));
  }
});
