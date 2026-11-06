import { beforeEach, expect, it, vi } from 'vitest';
const { adc, certificate } = vi.hoisted(() => ({ adc: vi.fn(() => ({ getAccessToken: async () => ({ access_token: 'dummy' }) })), certificate: vi.fn(() => ({ getAccessToken: async () => ({ access_token: 'dummy' }) })) }));
vi.mock('firebase-admin/app', () => ({ applicationDefault: adc, cert: certificate }));
import { googleCredential, readGoogleCredentials } from '../../src/google-auth.js';
beforeEach(() => vi.clearAllMocks());
it('未設定ではADCを選び、鍵を必要以上に複製しない', () => {
  expect(readGoogleCredentials({})).toBeUndefined();
  googleCredential({}); expect(adc).toHaveBeenCalledTimes(1); expect(certificate).not.toHaveBeenCalled();
});
it('手順書のGCP_SA_KEYを直接SDKへ渡せる', () => {
  const key = JSON.stringify({ type: 'service_account', project_id: 'p', client_email: 'dummy@example.com', private_key: 'dummy PRIVATE KEY' }); // submit-allow: 認証処理のモック専用
  const credentials = readGoogleCredentials({ GCP_SA_KEY: key }); expect(credentials?.project_id).toBe('p');
  googleCredential({ GCP_SA_KEY: key }); expect(certificate).toHaveBeenCalledWith({ projectId: 'p', clientEmail: 'dummy@example.com', privateKey: 'dummy PRIVATE KEY' });
});
it('形式が違うときも、例外には鍵の内容を含めない', () => {
  for (const value of ['private-content', '{"type":"authorized_user","refresh_token":"private-content"}', '{}']) {
    expect(() => readGoogleCredentials({ GCP_SA_KEY: value })).toThrow('GCP_SA_KEYの形式を確認してください（内容は表示しません）');
  }
});
