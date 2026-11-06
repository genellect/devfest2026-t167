import { readFileSync } from 'node:fs';
import { test, before, after } from 'node:test';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
import { ref, uploadBytes, getBytes } from 'firebase/storage';
let env;
before(async () => {
  const parse = (address) => {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(address ?? '')) throw new Error('専用ローカルエミュレータが必要です');
    const [host, port] = address.split(':'); return { host, port: Number(port) };
  };
  env = await initializeTestEnvironment({ projectId: process.env.GOOGLE_CLOUD_PROJECT ?? 'demo-t167',
    firestore: { ...parse(process.env.FIRESTORE_EMULATOR_HOST), rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
    storage: { ...parse(process.env.FIREBASE_STORAGE_EMULATOR_HOST), rules: readFileSync(new URL('../storage.rules', import.meta.url), 'utf8') },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'rooms/demo/members/alice'), { role: 'participant', group: 1 });
    await setDoc(doc(ctx.firestore(), 'rooms/demo/privateOpinions/alice'), { text: 'private-test' });
    await uploadBytes(ref(ctx.storage(), 'recordings/test.wav'), new Uint8Array([1, 2]));
  });
});
after(async () => { await env?.cleanup(); });
for (const kind of ['student', 'teacher', 'admin', 'revoked', 'refreshed', 'anonymous', 'guest']) {
  test(`${kind}: Firebase認証だけではFirestoreの読み書き・一覧を迂回できない`, async () => {
    const ctx = kind === 'guest' ? env.unauthenticatedContext() : env.authenticatedContext('alice', {
      firebase: { sign_in_provider: kind === 'anonymous' ? 'anonymous' : 'google.com' },
      ...(kind === 'teacher' ? { teacher: true } : {}), ...(kind === 'admin' ? { schoolAdmin: true, schoolId: 'school' } : {}),
    });
    for (const path of ['rooms/demo', 'rooms/demo/members/alice', 'rooms/demo/privateOpinions/alice', 'rooms/demo/messages/test', 'rooms/demo/results/group-1', 'users/alice/sessions/test', 'users/bob/sessions/test', 'schools/school/security/policy', 'securityEvents/test']) {
      await assertFails(getDoc(doc(ctx.firestore(), path))); await assertFails(setDoc(doc(ctx.firestore(), path), { spoof: true }));
    }
    await assertFails(getDocs(collection(ctx.firestore(), 'rooms/demo/results')));
  });
  test(`${kind}: Storageへ直接録音を読み書きできない`, async () => {
    const ctx = kind === 'guest' ? env.unauthenticatedContext() : env.authenticatedContext('alice', { firebase: { sign_in_provider: 'google.com' }, teacher: kind === 'teacher' });
    await assertFails(uploadBytes(ref(ctx.storage(), 'recordings/bypass.wav'), new Uint8Array([1])));
    await assertFails(getBytes(ref(ctx.storage(), 'recordings/test.wav')));
  });
}
