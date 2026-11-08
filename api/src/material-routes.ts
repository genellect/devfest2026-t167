import type { Express } from 'express';
import { z } from 'zod';
import { HttpError, parse, wrap, type Handler } from './http.js';
import type { Dependencies } from './dependencies.js';

/** 実セッションの共有資料を読む。Drive側の取得・追加処理とも同じ保存形式を使う。 */
export function registerMaterialRoutes(app: Express, deps: Dependencies, guards: { authenticate: Handler; member: Handler }) {
  const { authenticate, member } = guards;
  app.get('/rooms/:roomId/materials', authenticate, member, wrap(async (req, res) => {
    const files = await deps.db.collection(`sessions/${req.params.roomId}/materials`).limit(5).get();
    res.json({ files: files.docs.map(d => ({ id: d.id, name: String(d.get('name') ?? '共有資料').slice(0, 200), kind: 'pdf', bytes: d.get('bytes') })) });
  }));
  app.get('/rooms/:roomId/materials/:materialId/content', authenticate, member, wrap(async (req, res) => {
    const id = parse(z.string().regex(/^[a-f0-9]{64}$/), req.params.materialId);
    const ref = deps.db.doc(`sessions/${req.params.roomId}/materials/${id}`), metadata = await ref.get();
    if (!metadata.exists) throw new HttpError(404, 'material_not_found', '資料がありません');
    const count = parse(z.number().int().min(1).max(8), metadata.get('chunks'));
    const chunks = await Promise.all(Array.from({ length: count }, (_, i) => ref.collection('chunks').doc(String(i)).get()));
    if (chunks.some(c => !Buffer.isBuffer(c.get('data')) || c.get('data').length > 512 * 1024)) throw new HttpError(502, 'material_unavailable', '資料を読み込めませんでした');
    const pdf = Buffer.concat(chunks.map(c => c.get('data') as Buffer));
    if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new HttpError(502, 'material_unavailable', '資料を読み込めませんでした');
    const own = await deps.db.doc(`sessions/${req.params.roomId}/members/${req.ctx.uid}`).get();
    const current = await ref.get();
    if (!own.exists || own.get('status') === 'inactive') throw new HttpError(403, 'not_member', '参加者だけが閲覧できます');
    if (!current.exists || !current.updateTime?.isEqual(metadata.updateTime!)) throw new HttpError(404, 'material_not_found', '資料の共有状態が変わりました');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="material.pdf"');
    res.send(pdf);
  }));
}
