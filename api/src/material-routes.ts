import type { Express } from 'express';
import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { HttpError, parse, wrap, type AuthRequest, type Handler } from './http.js';
import type { Dependencies } from './dependencies.js';
import { createLimiter } from './limits.js';
import { run } from './http.js';
import { googleDrive, type Drive } from './drive.js';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
/** アクセストークンはメモリ上のリクエストだけ。Firebaseと同じGoogle本人かをサーバーで照合。 */
export async function driveIdentity(req: AuthRequest, workspace: Drive) {
  const token = req.header('x-google-access-token');
  if (!token || token.length > 4096 || /\s/.test(token)) throw new HttpError(409, 'google_reconnect', 'Googleサービスとの連携を許可してください');
  const identities = req.ctx.token?.firebase?.identities?.['google.com'];
  const sub = await workspace.identity(token);
  if (!Array.isArray(identities) || !identities.includes(sub)) throw new HttpError(403, 'google_account_mismatch', 'Toposにログイン中のGoogleアカウントを選んでください');
  return token;
}
const publicMaterial = (doc: { id: string; get(field: string): unknown }) => ({ id: doc.id, name: doc.get('name'), kind: 'pdf', originalMimeType: doc.get('originalMimeType'), bytes: doc.get('bytes') });
export function registerMaterialRoutes(app: Express, deps: Dependencies, handlers: { authenticate: Handler; member: Handler; host: Handler }) {
  const workspace = deps.drive ?? googleDrive();
  const { authenticate, member, host } = handlers;
  const limit = createLimiter(deps.db, deps.now);
  const googleLimit = run(async req => { await limit(req.ctx.uid, 'drive-material', 20); });
  app.get('/rooms/:roomId/materials', authenticate, member, wrap(async (req, res) => {
    const docs = await deps.db.collection(`sessions/${req.params.roomId}/materials`).get();
    res.json({ files: docs.docs.map(publicMaterial) });
  }));
  app.post('/rooms/:roomId/materials', authenticate, member, host, googleLimit, wrap(async (req, res) => {
    const { fileId, shareCopy } = parse(z.object({ fileId: id, shareCopy: z.literal(true) }).strict(), req.body);
    void shareCopy;
    const before = await deps.db.doc(`sessions/${req.params.roomId}`).get();
    if (before.get('phase') === 'closed' || before.get('endedAt')) throw new HttpError(409, 'room_closed', '終了したセッションには資料を追加できません');
    const token = await driveIdentity(req, workspace);
    const snapshot = await workspace.material(token, fileId);
    const materialId = createHash('sha256').update(fileId).digest('hex');
    const ref = deps.db.doc(`sessions/${req.params.roomId}/materials/${materialId}`);
    const chunkSize = 512 * 1024;
    try { await deps.db.runTransaction(async tx => {
      const room = await tx.get(deps.db.doc(`sessions/${req.params.roomId}`));
      const membership = await tx.get(deps.db.doc(`sessions/${req.params.roomId}/members/${req.ctx.uid}`));
      const current = await tx.get(ref);
      const files = await tx.get(ref.parent);
      if (membership.get('role') !== 'host' || membership.get('status') === 'inactive') throw new HttpError(403, 'not_moderator', 'Hostだけが資料を共有できます');
      if (room.get('phase') === 'closed' || room.get('endedAt')) throw new HttpError(409, 'room_closed', '終了したセッションには資料を追加できません');
      if (current.exists) return; // 同じ資料の再送で重複作成しない。更新は削除後に再共有する。
      if (files.size >= 5 || files.docs.reduce((n, d) => n + Number(d.get('bytes') ?? 0), 0) + snapshot.pdf.length > 8 * 1024 * 1024) throw new HttpError(413, 'materials_full', '資料は5件・合計8MBまで共有できます');
      tx.create(ref, { name: snapshot.name, originalMimeType: snapshot.originalMimeType, bytes: snapshot.pdf.length, chunks: Math.ceil(snapshot.pdf.length / chunkSize), sharedBy: req.ctx.uid, createdAt: FieldValue.serverTimestamp() });
      for (let start = 0, index = 0; start < snapshot.pdf.length; start += chunkSize, index++) tx.create(ref.collection('chunks').doc(String(index)), { data: snapshot.pdf.subarray(start, start + chunkSize) });
    }); } finally { snapshot.pdf.fill(0); }
    res.status(201).json({ file: publicMaterial(await ref.get()) });
  }));
  app.get('/rooms/:roomId/materials/:materialId/content', authenticate, member, wrap(async (req, res) => {
    const materialId = parse(z.string().regex(/^[a-f0-9]{64}$/), req.params.materialId);
    const ref = deps.db.doc(`sessions/${req.params.roomId}/materials/${materialId}`), doc = await ref.get();
    if (!doc.exists) throw new HttpError(404, 'material_not_found', '資料がありません');
    const count = parse(z.number().int().min(1).max(8), doc.get('chunks'));
    const chunks = await Promise.all(Array.from({ length: count }, (_, i) => ref.collection('chunks').doc(String(i)).get()));
    if (chunks.some(c => !Buffer.isBuffer(c.get('data')))) throw new HttpError(502, 'material_unavailable', '資料を読み込めませんでした');
    // 取得中に所属を取り消された場合も送信前に確認する。
    const [m, stillShared] = await deps.db.getAll(deps.db.doc(`sessions/${req.params.roomId}/members/${req.ctx.uid}`), ref);
    if (!m.exists || m.get('status') === 'inactive') throw new HttpError(403, 'not_member', '参加者だけが閲覧できます');
    if (!stillShared.exists) throw new HttpError(404, 'material_not_found', '資料の共有が解除されました');
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', 'inline; filename="material.pdf"');
    res.send(Buffer.concat(chunks.map(c => c.get('data') as Buffer)));
  }));
  app.post('/rooms/:roomId/materials/:materialId/remove', authenticate, member, host, wrap(async (req, res) => {
    const materialId = parse(z.string().regex(/^[a-f0-9]{64}$/), req.params.materialId);
    await deps.db.recursiveDelete(deps.db.doc(`sessions/${req.params.roomId}/materials/${materialId}`));
    res.json({ ok: true });
  }));
}
