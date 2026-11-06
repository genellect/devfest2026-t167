// エミュレータでのみ使う模擬Google認証。資格情報を実Googleへ送信しない。
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
export async function emulatorGoogleUser(kind, subject = `local-${kind}`) {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('ローカルAuthエミュレータを指定してください');
  if (!getApps().length) initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT ?? 'demo-t167' });
  async function signIn() {
    const response = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestUri: 'http://localhost', returnSecureToken: true,
        postBody: new URLSearchParams({ providerId: 'google.com', id_token: JSON.stringify({ sub: subject, email: `${subject}@example.com`, email_verified: true, name: kind }) }).toString() }),
    });
    if (!response.ok) throw new Error('模擬Google認証に失敗しました');
    return response.json();
  }
  const user = await signIn();
  await getAuth().setCustomUserClaims(user.localId, kind === 'teacher' ? { teacher: true } : {});
  return signIn(); // claims を含む新しいトークン
}
