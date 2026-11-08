import type { Express } from 'express';
import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { HttpError, parse, requireOpenRoom, wrap, type AuthRequest, type Handler } from './http.js';
import type { Dependencies } from './dependencies.js';
import { createLimiter } from './limits.js';
import { run } from './http.js';
import { googleWorkspace, type Workspace } from './workspace.js';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const publicMaterial = (doc: { id: string; get(field: string): unknown }) => ({ id: doc.id, name: doc.get('name'), kind: 'pdf', bytes: doc.get('bytes') });
/** アクセストークンはメモリ上のリクエストだけ。Firebaseと同じGoogle本人かをサーバーで照合。 */
export async function workspaceIdentity(req: AuthRequest, workspace: Workspace) {
  const token = req.header('x-google-access-token');
  if (!token || token.length > 4096 || /\s/.test(token)) throw new HttpError(409, 'google_reconnect', 'Googleサービスとの連携を許可してください');
  const identities = req.ctx.token?.firebase?.identities?.['google.com'];
  const sub = await workspace.identity(token);
  if (!Array.isArray(identities) || !identities.includes(sub)) throw new HttpError(403, 'google_account_mismatch', 'Discussにログイン中のGoogleアカウントを選んでください');
  return token;
}
export function registerDriveMaterialRoutes(app: Express, deps: Dependencies, handlers: { authenticate: Handler; member: Handler; host: Handler }) {
  const workspace = deps.workspace ?? googleWorkspace();
  const { authenticate, member, host } = handlers;
  const limit = createLimiter(deps.db, deps.now);
  const googleLimit = run(async req => { await limit(req.ctx.uid, 'workspace', 60); });
  app.post('/rooms/:roomId/materials', authenticate, member, host, googleLimit, wrap(async (req, res) => {
    const { fileId, shareCopy } = parse(z.object({ fileId: id, shareCopy: z.literal(true) }).strict(), req.body);
    void shareCopy;
    const token = await workspaceIdentity(req, workspace);
    const snapshot = await workspace.material(token, fileId);
    const materialId = createHash('sha256').update(fileId).digest('hex');
    const ref = deps.db.doc(`sessions/${req.params.roomId}/materials/${materialId}`);
    const chunkSize = 512 * 1024;
    try {
    if (snapshot.pdf.length > 4 * 1024 * 1024) throw new HttpError(413, 'material_too_large', '資料はPDF変換後4MB以内にしてください');
    if (!snapshot.pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new HttpError(502, 'invalid_pdf', '閲覧用PDFを取得できませんでした');
    await deps.db.runTransaction(async tx => {
      const room = await tx.get(deps.db.doc(`sessions/${req.params.roomId}`));
      const membership = await tx.get(deps.db.doc(`sessions/${req.params.roomId}/members/${req.ctx.uid}`));
      const current = await tx.get(ref);
      const files = await tx.get(ref.parent);
      requireOpenRoom(room);
      if (membership.get('role') !== 'host' || membership.get('status') === 'inactive') throw new HttpError(403, 'not_moderator', 'Hostだけが資料を共有できます');
      if (room.get('phase') === 'closed' || room.get('endedAt')) throw new HttpError(409, 'room_closed', '終了したセッションには資料を追加できません');
      if (current.exists) return; // 同じ資料の再送で重複作成しない。更新は削除後に再共有する。
      if (files.size >= 5 || files.docs.reduce((n, d) => n + Number(d.get('bytes') ?? 0), 0) + snapshot.pdf.length > 8 * 1024 * 1024) throw new HttpError(413, 'materials_full', '資料は5件・合計8MBまで共有できます');
      tx.create(ref, { name: snapshot.name, originalMimeType: snapshot.originalMimeType, bytes: snapshot.pdf.length, chunks: Math.ceil(snapshot.pdf.length / chunkSize), sharedBy: req.ctx.uid, createdAt: FieldValue.serverTimestamp() });
      for (let start = 0, index = 0; start < snapshot.pdf.length; start += chunkSize, index++) tx.create(ref.collection('chunks').doc(String(index)), { data: snapshot.pdf.subarray(start, start + chunkSize) });
    });
    res.status(201).json({ file: publicMaterial(await ref.get()) });
    } finally { snapshot.pdf.fill(0); }
  }));
  app.post('/rooms/:roomId/materials/:materialId/remove', authenticate, member, host, wrap(async (req, res) => {
    const materialId = parse(z.string().regex(/^[a-f0-9]{64}$/), req.params.materialId);
    const ref = deps.db.doc(`sessions/${req.params.roomId}/materials/${materialId}`);
    await deps.db.runTransaction(async tx => {
      const membership = await tx.get(deps.db.doc(`sessions/${req.params.roomId}/members/${req.ctx.uid}`));
      const chunks = await tx.get(ref.collection('chunks'));
      if (membership.get('role') !== 'host' || membership.get('status') === 'inactive') throw new HttpError(403, 'not_moderator', 'Hostだけが資料の共有を解除できます');
      for (const chunk of chunks.docs) tx.delete(chunk.ref);
      tx.delete(ref);
    });
    res.json({ ok: true });
  }));
}
