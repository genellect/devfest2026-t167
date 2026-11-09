import { HttpError } from './http.js';
export interface DriveSnapshot { name: string; originalMimeType: string; pdf: Buffer }
export interface Drive { identity(token: string): Promise<string>; material(token: string, fileId: string): Promise<DriveSnapshot> }
export const MAX_MATERIAL_BYTES = 4 * 1024 * 1024;
const NATIVE_TYPES = new Set(['application/vnd.google-apps.document', 'application/vnd.google-apps.presentation', 'application/vnd.google-apps.spreadsheet']);
const unavailable = () => new HttpError(502, 'google_unavailable', 'Googleに接続できませんでした。もう一度お試しください');

/** Googleの応答本文・URL・トークンはエラーやログへ出さない。全て固定ホストへ送る。 */
export function googleDrive(fetcher: typeof fetch = fetch): Drive {
  async function request(url: string, token: string) {
    let response: Response;
    try { response = await fetcher(url, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(20_000) }); }
    catch { throw unavailable(); }
    if (response.status === 401) throw new HttpError(409, 'google_reconnect', 'Googleとの連携をやり直してください');
    if (response.status === 403) throw new HttpError(403, 'google_permission', 'Google側のアクセス許可を確認してください。学校の設定で制限されている場合もあります');
    if (response.status === 404) throw new HttpError(404, 'google_not_found', '資料またはコースが見つかりません');
    if (!response.ok) throw unavailable();
    return response;
  }
  async function bytes(response: Response, max: number) {
    if (Number(response.headers.get('content-length')) > max) { await response.body?.cancel(); throw new HttpError(413, 'material_too_large', '資料はPDF変換後4MB以内にしてください'); }
    const reader = response.body?.getReader();
    if (!reader) throw unavailable();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
        if (size > max) { await reader.cancel(); throw new HttpError(413, 'material_too_large', '資料はPDF変換後4MB以内にしてください'); }
        chunks.push(value);
      }
      return Buffer.concat(chunks, size);
    } finally { reader.releaseLock(); }
  }
  async function json(url: string, token: string): Promise<Record<string, unknown>> {
    try { const value: unknown = JSON.parse((await bytes(await request(url, token), 1024 * 1024)).toString()); if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable(); return value as Record<string, unknown>; }
    catch (error) { if (error instanceof HttpError) throw error; throw unavailable(); }
  }
  return {
    async identity(token) { const info = await json('https://openidconnect.googleapis.com/v1/userinfo', token); if (typeof info.sub !== 'string') throw unavailable(); return info.sub; },
    async material(token, id) {
      const base = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`;
      const meta = await json(`${base}?fields=id,name,mimeType,trashed,capabilities(canDownload)&supportsAllDrives=true`, token);
      if (meta.trashed || (meta.capabilities as { canDownload?: boolean })?.canDownload === false) throw new HttpError(403, 'material_restricted', 'この資料はダウンロード・配布が許可されていません');
      if (typeof meta.name !== 'string' || typeof meta.mimeType !== 'string') throw unavailable();
      const native = NATIVE_TYPES.has(meta.mimeType);
      if (!native && meta.mimeType !== 'application/pdf') throw new HttpError(400, 'material_type', 'PDF・Google Docs・Slides・Sheetsを選択してください');
      const pdf = await bytes(await request(native ? `${base}/export?mimeType=application%2Fpdf` : `${base}?alt=media&supportsAllDrives=true`, token), MAX_MATERIAL_BYTES);
      if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new HttpError(502, 'invalid_pdf', '閲覧用PDFを取得できませんでした');
      return { name: meta.name.slice(0, 200), originalMimeType: meta.mimeType, pdf };
    },
  };
}
