import { describe, expect, it, vi } from 'vitest';
import { googleWorkspace, MAX_MATERIAL_BYTES } from '../../src/workspace.js';
import { HttpError } from '../../src/http.js';
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const pdf = () => new Response('%PDF-1.7\nexample', { headers: { 'content-type': 'application/pdf' } });
describe('Google Workspaceの実接続アダプター', () => {
  it('本人確認は固定のUserInfoへBearerで送り、生の応答を公開しない', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ sub: 'google-sub' }));
    expect(await googleWorkspace(fetcher).identity('private-token')).toBe('google-sub');
    expect(fetcher.mock.calls[0][0]).toBe('https://openidconnect.googleapis.com/v1/userinfo');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error', headers: { Authorization: 'Bearer private-token' } });
  });
  it('教師・生徒のコースを別々に全ページ取得し、コースごとに役割を保持する', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ courses: [{ id: 'a', name: '教師A' }], nextPageToken: 'next' }))
      .mockResolvedValueOnce(json({ courses: [{ id: 'c', name: '教師C', section: '1年' }] }))
      .mockResolvedValueOnce(json({ courses: [{ id: 'b', name: '生徒B' }] }));
    expect(await googleWorkspace(fetcher).courses('t')).toEqual([{ id: 'b', name: '生徒B', role: 'student' }, { id: 'a', name: '教師A', role: 'teacher' }, { id: 'c', name: '教師C', section: '1年', role: 'teacher' }]);
    expect(String(fetcher.mock.calls[1][0])).toContain('pageToken=next');
    expect(String(fetcher.mock.calls[2][0])).toContain('studentId=me');
  });
  it('空コースと空名簿を扱い、名簿に不要なメール・プロフィールを返さない', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({})).mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(json({ students: [{ userId: 's', profile: { name: { fullName: '表示名' }, emailAddress: 'private@example.com' } }, { userId: 's2' }] }));
    const w = googleWorkspace(fetcher); expect(await w.courses('t')).toEqual([]);
    expect(await w.roster('t', 'course')).toEqual([{ id: 's', name: '表示名' }, { id: 's2', name: '参加者' }]);
  });
  it.each(['application/vnd.google-apps.document', 'application/vnd.google-apps.presentation', 'application/vnd.google-apps.spreadsheet'])('ネイティブ文書%sをPDFへ変換する', async mimeType => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ name: '資料', mimeType, capabilities: { canDownload: true } })).mockResolvedValueOnce(pdf());
    const file = await googleWorkspace(fetcher).material('t', 'file'); expect(file.name).toBe('資料'); expect(file.originalMimeType).toBe(mimeType); expect(file.pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(String(fetcher.mock.calls[1][0])).toContain('/export?mimeType=application%2Fpdf');
  });
  it('PDFをそのまま取得する', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ name: '資料.pdf', mimeType: 'application/pdf' })).mockResolvedValueOnce(pdf());
    await googleWorkspace(fetcher).material('t', 'file'); expect(String(fetcher.mock.calls[1][0])).toContain('alt=media');
  });
  it.each([{ trashed: true }, { capabilities: { canDownload: false } }])('配布禁止・削除済み資料を取得しない', async restrictions => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ name: '資料', mimeType: 'application/pdf', ...restrictions }));
    await expect(googleWorkspace(fetcher).material('t', 'file')).rejects.toMatchObject({ code: 'material_restricted' }); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('未対応形式・PDF以外の内容・過大なPDFを拒否する', async () => {
    let fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ name: 'x', mimeType: 'text/html' }));
    await expect(googleWorkspace(fetcher).material('t', 'file')).rejects.toMatchObject({ code: 'material_type' });
    fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ name: 'x', mimeType: 'application/pdf' })).mockResolvedValueOnce(new Response('<html>bad</html>'));
    await expect(googleWorkspace(fetcher).material('t', 'file')).rejects.toMatchObject({ code: 'invalid_pdf' });
    fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ name: 'x', mimeType: 'application/pdf' })).mockResolvedValueOnce(new Response('x', { headers: { 'content-length': String(MAX_MATERIAL_BYTES + 1) } }));
    await expect(googleWorkspace(fetcher).material('t', 'file')).rejects.toMatchObject({ status: 413 });
    fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ name: 'x', mimeType: 'application/pdf' })).mockResolvedValueOnce(new Response(Buffer.alloc(MAX_MATERIAL_BYTES + 1)));
    await expect(googleWorkspace(fetcher).material('t', 'file')).rejects.toMatchObject({ status: 413 });
  });
  it.each([[401, 409, 'google_reconnect'], [403, 403, 'google_permission'], [404, 404, 'google_not_found'], [500, 502, 'google_unavailable']])('Googleの%sを安全な%sへ変換する', async (status, expectedStatus, code) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ error: 'SECRET' }, status as number));
    try { await googleWorkspace(fetcher).identity('token'); throw new Error('unexpected'); }
    catch (e) { expect(e).toBeInstanceOf(HttpError); expect(e).toMatchObject({ status: expectedStatus, code }); expect((e as Error).message).not.toContain('SECRET'); }
  });
  it('ネットワーク障害や壊れたGoogle応答を安全なエラーにする', async () => {
    await expect(googleWorkspace(vi.fn<typeof fetch>().mockRejectedValue(new Error('SECRET'))).identity('t')).rejects.toMatchObject({ code: 'google_unavailable' });
    for (const data of [null, { nope: true }]) await expect(googleWorkspace(vi.fn<typeof fetch>().mockResolvedValue(json(data))).identity('t')).rejects.toBeInstanceOf(Error);
    await expect(googleWorkspace(vi.fn<typeof fetch>().mockResolvedValue(new Response('invalid-json'))).identity('t')).rejects.toMatchObject({ code: 'google_unavailable' });
    await expect(googleWorkspace(vi.fn<typeof fetch>().mockResolvedValue(json({ courses: {} }))).courses('t')).rejects.toMatchObject({ code: 'google_unavailable' });
  });
});
it('ページ取得全体の期限を超えた場合はGoogleへの追加リクエストを行わない', async () => {
  const fetcher=vi.fn<typeof fetch>();
  const now=vi.spyOn(Date,'now').mockReturnValueOnce(0).mockReturnValue(30_000);
  try { await expect(googleWorkspace(fetcher).courses('t')).rejects.toMatchObject({code:'google_unavailable'});expect(fetcher).not.toHaveBeenCalled(); }
  finally { now.mockRestore(); }
});
