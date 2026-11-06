// 管理者が明示して実行する。公開API・通常の起動・デプロイからは呼び出さない。
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function teacherOptions(args) {
  try {
    const { values } = parseArgs({ args, options: {
      project: { type: 'string' }, uid: { type: 'string' }, action: { type: 'string' },
    }, allowPositionals: false });
    if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(values.project ?? '')
      || !/^[A-Za-z0-9:_-]{1,128}$/.test(values.uid ?? '')
      || !['inspect', 'grant', 'revoke'].includes(values.action)) throw new Error();
    return values;
  } catch { throw new Error('--project・--uid・--action inspect|grant|revokeを明示してください'); }
}

export async function teacherAccess(auth, { uid, action }) {
  const user = await auth.getUser(uid);
  const googleLogin = user.providerData.some(provider => provider.providerId === 'google.com');
  if (action === 'inspect') return { teacher: user.customClaims?.teacher === true, googleLogin, disabled: user.disabled, changed: false };
  if (action === 'grant' && (!googleLogin || user.disabled)) throw new Error('有効なGoogleログインの利用者だけを教師に設定できます');
  const claims = { ...user.customClaims };
  if (action === 'grant') claims.teacher = true;
  else if (action === 'revoke') delete claims.teacher;
  else throw new Error('操作を確認してください');
  await auth.setCustomUserClaims(uid, claims); // 他用途のclaimを保持する。
  await auth.revokeRefreshTokens(uid); // 古い教師トークンを有効なまま残さない。
  return { teacher: action === 'grant', changed: true, signInAgain: true };
}

async function main() {
  try {
    const options = teacherOptions(process.argv.slice(2));
    if (process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST) throw new Error('emulator');
    const require = createRequire(new URL('../api/package.json', import.meta.url));
    const { initializeApp } = require('firebase-admin/app');
    const { getAuth } = require('firebase-admin/auth');
    const { googleCredential } = await import('../api/src/google-auth.ts');
    initializeApp({ projectId: options.project, credential: googleCredential(process.env) });
    console.info(JSON.stringify(await teacherAccess(getAuth(), options)));
  } catch {
    // SDKの例外・UID・メール・鍵・トークンを表示しない。
    console.error('教師権限を確認・更新できませんでした。引数、管理者のADC、対象プロジェクトの権限、エミュレータ設定の解除を確認してください');
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
