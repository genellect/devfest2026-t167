import { HttpError } from './http.js';

export interface Course { id: string; name: string; section?: string; role: 'teacher' | 'student' }
export interface DriveSnapshot { name: string; originalMimeType: string; pdf: Buffer }
export interface Workspace {
  identity(token: string): Promise<string>;
  courses(token: string): Promise<Course[]>;
  roster(token: string, courseId: string): Promise<{ id: string; name: string }[]>;
  material(token: string, fileId: string): Promise<DriveSnapshot>;
}
export const MAX_MATERIAL_BYTES = 4 * 1024 * 1024;
const NATIVE_TYPES = new Set(['application/vnd.google-apps.document', 'application/vnd.google-apps.presentation', 'application/vnd.google-apps.spreadsheet']);
const unavailable = () => new HttpError(502, 'google_unavailable', 'Googleに接続できませんでした。もう一度お試しください');

/** Googleの応答本文・URL・トークンはエラーやログへ出さない。全て固定ホストへ送る。 */
export function googleWorkspace(fetcher: typeof fetch = fetch): Workspace {
  async function request(url: string, token: string, deadline = Date.now() + 20_000) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw unavailable();
    let response: Response;
    try { response = await fetcher(url, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(remaining) }); }
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
  async function json(url: string, token: string, deadline?: number): Promise<Record<string, unknown>> {
    try { const value: unknown = JSON.parse((await bytes(await request(url, token, deadline), 1024 * 1024)).toString()); if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable(); return value as Record<string, unknown>; }
    catch (error) { if (error instanceof HttpError) throw error; throw unavailable(); }
  }
  async function pages(url: string, key: string, token: string) {
    const rows: Record<string, unknown>[] = []; let pageToken = '';
    const deadline = Date.now() + 20_000;
    for (let page = 0; page < 100; page++) {
      const data = await json(`${url}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, token, deadline);
      const items = data[key]; if (items !== undefined && !Array.isArray(items)) throw unavailable();
      if (Array.isArray(items) && items.some(item => !item || typeof item !== 'object' || Array.isArray(item))) throw unavailable();
      rows.push(...(items ?? []) as Record<string, unknown>[]);
      if (!data.nextPageToken) return rows;
      if (typeof data.nextPageToken !== 'string') throw unavailable(); pageToken = data.nextPageToken;
    }
    throw new HttpError(413, 'too_many_courses', '取得件数が上限に達しました');
  }
  return {
    async identity(token) { const info = await json('https://openidconnect.googleapis.com/v1/userinfo', token); if (typeof info.sub !== 'string') throw unavailable(); return info.sub; },
    async courses(token) {
      const teachers = await pages('https://classroom.googleapis.com/v1/courses?teacherId=me&courseStates=ACTIVE&pageSize=100&fields=nextPageToken,courses(id,name,section,courseState)', 'courses', token);
      const students = await pages('https://classroom.googleapis.com/v1/courses?studentId=me&courseStates=ACTIVE&pageSize=100&fields=nextPageToken,courses(id,name,section,courseState)', 'courses', token);
      const courses = new Map<string, Course>();
      for (const [rows, role] of [[students, 'student'], [teachers, 'teacher']] as const) for (const c of rows) {
        if (c.courseState !== undefined && c.courseState !== 'ACTIVE') continue;
        if (typeof c.id !== 'string' || typeof c.name !== 'string') throw unavailable();
        courses.set(c.id, { id: c.id, name: c.name, ...(typeof c.section === 'string' ? { section: c.section } : {}), role });
      }
      return [...courses.values()];
    },
    async roster(token, id) {
      return (await pages(`https://classroom.googleapis.com/v1/courses/${encodeURIComponent(id)}/students?pageSize=100&fields=nextPageToken,students(userId,profile(name(fullName)))`, 'students', token)).map(row => {
        const profile = row.profile as { name?: { fullName?: string } } | undefined;
        if (typeof row.userId !== 'string' || (profile?.name?.fullName !== undefined && typeof profile.name.fullName !== 'string')) throw unavailable();
        return { id: row.userId, name: profile?.name?.fullName ?? '参加者' };
      });
    },
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
