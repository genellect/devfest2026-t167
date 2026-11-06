import { applicationDefault, cert, type Credential } from 'firebase-admin/app';

/** 手順書のAI用環境変数を、ファイルやログに書かずSDKに渡す。未設定ならADCを使う。 */
export interface GoogleCredentials { type: 'service_account'; project_id: string; client_email: string; private_key: string }
export function readGoogleCredentials(env: Record<string, string | undefined>): GoogleCredentials | undefined {
  const raw = env.GCP_SA_KEY?.trim();
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as Partial<GoogleCredentials>;
    if (value.type !== 'service_account' || !value.project_id || !value.client_email || !value.private_key?.includes('PRIVATE KEY')) throw new Error();
    return { type: 'service_account', project_id: value.project_id, client_email: value.client_email, private_key: value.private_key };
  } catch { throw new Error('GCP_SA_KEYの形式を確認してください（内容は表示しません）'); }
}
export function googleCredential(env: Record<string, string | undefined>): Credential {
  const credentials = readGoogleCredentials(env);
  return credentials ? cert({ projectId: credentials.project_id, clientEmail: credentials.client_email, privateKey: credentials.private_key }) : applicationDefault();
}
