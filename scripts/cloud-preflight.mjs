// 認証済みかだけを確かめ、トークン・鍵・アカウント名を表示しない。
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { googleCredential } from '../api/src/google-auth.ts';
const mode = process.argv[2];
let timer;
try {
  if (!['vertex', 'cloud', 'probe'].includes(mode)) throw new Error('接続モードを確認してください');
  if (existsSync('web/.env.local')) process.loadEnvFile('web/.env.local');
  if (mode === 'cloud') {
    const names = ['NEXT_PUBLIC_FIREBASE_API_KEY', 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', 'NEXT_PUBLIC_FIREBASE_APP_ID'];
    const missing = names.filter((name) => !process.env[name]?.trim());
    if (missing.length) throw new Error(`実接続用のFirebase Web設定がありません：${missing.join('・')}（web/.env.local）`);
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS && !existsSync(resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS))) throw new Error('GOOGLE_APPLICATION_CREDENTIALSのファイルを確認してください');
  process.env.METADATA_SERVER_DETECTION = 'none';
  const credential = googleCredential(process.env);
  const token = await Promise.race([
    credential.getAccessToken(),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('認証確認が時間切れになりました')), 15_000); timer.unref(); }),
  ]);
  if (!token?.access_token) throw new Error('認証を確認できません');
  console.log('OK: Google Cloud認証を確認しました（Vertexの実行権限・生成成功は別途検証）');
} catch (error) {
  const message = error instanceof Error && /^(GCP_SA_KEY|実接続用|GOOGLE_APPLICATION_CREDENTIALS|接続モード)/.test(error.message)
    ? error.message : 'Google Cloud認証を確認できません。手順書のADC（gcloud auth application-default login）またはGCP_SA_KEYを、この端末の実行環境に設定してください';
  console.error(`NG: ${message}`); process.exitCode = 1;
} finally { clearTimeout(timer); }
