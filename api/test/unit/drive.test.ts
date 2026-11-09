import { expect, it } from 'vitest';
import { googleDrive, MAX_MATERIAL_BYTES } from '../../src/drive.js';

const pdf = '%PDF-1.7\nfixture';
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
it('Google本人確認は固定のuserinfoにだけ送り、subを返す', async () => {
  const drive = googleDrive(async (url, options) => {
    expect(String(url)).toBe('https://openidconnect.googleapis.com/v1/userinfo');
    expect(options?.headers).toEqual({ Authorization: 'Bearer fixture-token' });
    expect(options?.redirect).toBe('error');
    return json({ sub: 'google-sub' });
  });
  expect(await drive.identity('fixture-token')).toBe('google-sub');
});

it.each(['application/pdf', 'application/vnd.google-apps.document', 'application/vnd.google-apps.presentation', 'application/vnd.google-apps.spreadsheet'])('対応形式 %s から閲覧用PDFを取得する', async mimeType => {
  const paths: string[] = [];
  const drive = googleDrive(async url => {
    paths.push(String(url));
    return paths.length === 1 ? json({ name: '教材', mimeType, capabilities: { canDownload: true } }) : new Response(pdf);
  });
  const file = await drive.material('fixture-token', 'file-id');
  expect(file.name).toBe('教材'); expect(file.pdf.toString()).toBe(pdf);
  expect(paths[1]).toContain(mimeType === 'application/pdf' ? '?alt=media' : '/export?mimeType=application%2Fpdf');
});

it.each([{ trashed: true }, { capabilities: { canDownload: false } }])('ごみ箱・配布制限のある資料は取得しない: %j', async extra => {
  let calls = 0;
  const drive = googleDrive(async () => { calls++; return json({ name: '教材', mimeType: 'application/pdf', ...extra }); });
  await expect(drive.material('fixture-token', 'id')).rejects.toMatchObject({ status: 403 });
  expect(calls).toBe(1);
});

it.each([[401, 409], [403, 403], [404, 404], [500, 502]])('Google %i は本文を出さずアプリの %i にする', async (upstream, status) => {
  const drive = googleDrive(async () => new Response('upstream-private-text', { status: upstream }));
  await expect(drive.identity('fixture-token')).rejects.toMatchObject({ status });
  await expect(drive.identity('fixture-token')).rejects.not.toThrow('upstream-private-text');
});

it('通信失敗と不正JSONを内部情報なしで処理する', async () => {
  await expect(googleDrive(async () => { throw new Error('private-token'); }).identity('token')).rejects.toMatchObject({ status: 502 });
  for (const response of [new Response('invalid-json'), json([]), json(null), json({}), new Response(null)]) {
    await expect(googleDrive(async () => response).identity('token')).rejects.toMatchObject({ status: 502 });
  }
});

it('未対応形式・不正メタデータ・PDF以外の内容を拒否する', async () => {
  await expect(googleDrive(async () => json({ name: '教材', mimeType: 'text/html' })).material('token', 'id')).rejects.toMatchObject({ status: 400 });
  await expect(googleDrive(async () => json({ name: '教材' })).material('token', 'id')).rejects.toMatchObject({ status: 502 });
  let count = 0;
  const drive = googleDrive(async () => ++count === 1 ? json({ name: '教材', mimeType: 'application/pdf' }) : new Response('not-a-pdf'));
  await expect(drive.material('token', 'id')).rejects.toMatchObject({ code: 'invalid_pdf' });
});

it('Content-Lengthとストリームの両方で資料の容量を制限する', async () => {
  for (const oversized of [
    () => new Response('small', { headers: { 'content-length': String(MAX_MATERIAL_BYTES + 1) } }),
    () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_MATERIAL_BYTES)); controller.enqueue(new Uint8Array(1)); controller.close(); } })),
  ]) {
    let count = 0;
    const drive = googleDrive(async () => ++count === 1 ? json({ name: '教材', mimeType: 'application/pdf' }) : oversized());
    await expect(drive.material('token', 'id')).rejects.toMatchObject({ status: 413 });
  }
});
