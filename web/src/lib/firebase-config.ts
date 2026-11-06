import type { FirebaseOptions } from 'firebase/app';
export type PublicFirebaseEnv = {
  apiKey?: string; authDomain?: string; projectId?: string; appId?: string;
};
/** App Hosting の自動設定は維持し、ローカル実接続ではWebアプリの公開設定を明示する。 */
export function publicFirebaseConfig(values: PublicFirebaseEnv): FirebaseOptions | undefined {
  const explicit = values.apiKey || values.authDomain || values.appId;
  if (!explicit) return undefined;
  const required = ['apiKey', 'authDomain', 'projectId', 'appId'] as const;
  const missing = required.filter((key) => !values[key]?.trim());
  if (missing.length) throw new Error(`FirebaseのWeb設定が不足しています：${missing.join('・')}`);
  return Object.fromEntries(required.map((key) => [key, values[key]!.trim()]));
}
