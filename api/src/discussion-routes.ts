import type { Express } from 'express';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import type { Dependencies } from './dependencies.js';
import { HttpError, parse, wrap, requireOpenRoom, type Handler } from './http.js';
import { endDiscussion, enforceDiscussionTime } from './discussion-lifecycle.js';
import { createGroupService } from './groups.js';
import { MAX_GROUPS, statusOf } from './policy.js';
import { wireData, mayReadResult } from './live-routes.js';
import { participantTitle } from './room-visibility.js';

/** 認証用 /sessions と議論用 /discussions を分離する。議論の保存先はトップ階層 sessions。 */
export function registerDiscussionRoutes(app: Express, deps: Dependencies, guards: { authenticate: Handler; member: Handler; host: Handler }) {
  const { db } = deps;
  const { refreshGroup } = createGroupService(deps);
  const { authenticate, member, host } = guards;
  const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
  const groupId = z.coerce.number().int().min(1).max(MAX_GROUPS);
  /** 録音担当として見せる名前。共用端末は登録した全員の表示名を並べる */
  const recorderName = (m: FirebaseFirestore.DocumentSnapshot) => ((m.get('attendees') as { displayName: string }[] | undefined)?.map((a) => a.displayName).join('、') || m.get('displayName') || '参加者').slice(0, 80);
  app.post('/rooms/:roomId/check-time', authenticate, member, wrap(async (req, res) => {
    await enforceDiscussionTime(deps, req.params.roomId); res.json({ ok: true });
  }));
  app.post('/rooms/:roomId/finish', authenticate, member, host, wrap(async (req, res) => {
    await endDiscussion(deps, req.params.roomId, 'host', true); res.json({ ok: true });
  }));
  app.get('/discussions', authenticate, wrap(async (req, res) => {
    const links = await db.collection(`users/${req.ctx.uid}/discussions`).get();
    const memberships = links.empty ? [] : await db.getAll(...links.docs.map((d) => db.doc(`sessions/${d.id}/members/${req.ctx.uid}`)));
    const entries = memberships.filter((m) => m.exists && m.get('status') === 'active');
    const docs = entries.length ? await db.getAll(...entries.map((m) => m.ref.parent.parent!)) : [];
    res.json({ sessions: docs.flatMap((d, i) => {
      if (!d.exists) return [];
      // テーマ非公開の議論では、参加者へテーマ本文を theme でも title でも返さない（Host には元の値）
      const themeHidden = entries[i].get('role') !== 'host' && d.get('participantView.theme') === false;
      return [{ sessionId: d.id, title: participantTitle({ title: d.get('title'), theme: d.get('theme'), themeHidden }), theme: themeHidden ? '' : d.get('theme') ?? '', phase: d.get('phase'), ended: !!d.get('endedAt') || d.get('phase') === 'closed', role: entries[i].get('role'), groupId: entries[i].get('groupId') ?? null }];
    }) });
  }));
  const settings = z.object({ title: z.string().trim().min(1).max(100).optional(), theme: z.string().trim().max(1000).optional(), minutes: z.number().int().min(1).max(180).optional(), groupSelection: z.enum(['host', 'participant']).optional(), publishOnEnd: z.boolean().optional(), participantView: z.object({ theme: z.boolean(), timer: z.boolean(), members: z.boolean(), speaking: z.boolean().optional() }).strict().optional(), resultsPublished: z.boolean().optional() }).strict().refine((v) => Object.keys(v).length > 0);
  app.post('/rooms/:roomId/settings', authenticate, member, host, wrap(async (req, res) => {
    const patch = parse(settings, req.body);
    await db.runTransaction(async (tx) => {
      const ref = db.doc(`sessions/${req.params.roomId}`), room = await tx.get(ref);
      if (!room.exists) throw new HttpError(404, 'room_not_found', 'セッションがありません');
      // 終了後は公開設定だけを変えられる。
      if (room.get('phase') === 'closed' && Object.keys(patch).some((k) => k !== 'resultsPublished')) throw new HttpError(409, 'room_closed', '終了後は公開設定だけ変更できます');
      tx.update(ref, { ...patch, ...(patch.minutes !== undefined && room.get('phase') === 'discussing' && room.get('startedAt') instanceof Timestamp ? { endsAt: Timestamp.fromMillis(room.get('startedAt').toMillis() + patch.minutes * 60_000) } : {}) });
    });
    res.json({ ok: true });
  }));
  app.get('/rooms/:roomId/groups', authenticate, member, wrap(async (req, res) => {
    const path = `sessions/${req.params.roomId}`;
    const own = await db.doc(`${path}/members/${req.ctx.uid}`).get();
    const groups = await db.collection(`${path}/groups`).get();
    res.json({ groups: groups.docs.filter((g) => req.ctx.role === 'host' || g.id === own.get('groupId')).map((g) => ({ ...g.data(), groupId: g.id })) });
  }));
  app.post('/rooms/:roomId/groups/create', authenticate, member, host, wrap(async (req, res) => {
    const { name } = parse(z.object({ name: z.string().trim().min(1).max(60) }).strict(), req.body);
    const group = await db.runTransaction(async (tx) => {
      const ref = db.doc(`sessions/${req.params.roomId}`), room = await tx.get(ref); requireOpenRoom(room);
      const n = room.get('groups') + 1;
      if (room.get('phase') !== 'collecting' || n > MAX_GROUPS) throw new HttpError(409, 'group_settings_locked', '開始前のみグループを追加できます');
      tx.create(ref.collection('groups').doc(String(n)), { groupId: String(n), number: n, name });
      tx.update(ref, { groups: n }); return n;
    });
    res.status(201).json({ groupId: String(group) });
  }));
  app.post('/rooms/:roomId/groups/update', authenticate, member, host, wrap(async (req, res) => {
    const body = parse(z.object({ group: groupId, name: z.string().trim().min(1).max(60), recorderUid: id.nullable().default(null) }).strict(), req.body);
    await db.runTransaction(async (tx) => {
      const ref = db.doc(`sessions/${req.params.roomId}`), room = await tx.get(ref); requireOpenRoom(room);
      if (body.group > room.get('groups')) throw new HttpError(404, 'group_not_found', 'グループがありません');
      const recorder = body.recorderUid ? await tx.get(ref.collection('members').doc(body.recorderUid)) : null;
      if (recorder && (recorder.get('role') !== 'participant' || recorder.get('status') !== 'active' || recorder.get('group') !== body.group)) throw new HttpError(400, 'invalid_recorder', '同じグループの参加者を選んでください');
      tx.set(ref.collection('groups').doc(String(body.group)), { groupId: String(body.group), number: body.group, name: body.name, recorderUid: body.recorderUid, recorderName: recorder ? recorderName(recorder) : null });
    }); res.json({ ok: true });
  }));
  // 録音の担当を引き受ける／やめる（参加者）。教員が担当を決めていないグループでは、最初に録音を始めた端末が担当になり、
  // ほかの人の画面に「〇〇さんの端末が録音を担当しています」と出す（Docs「アプリフィードバック」）
  app.post('/rooms/:roomId/groups/recorder', authenticate, member, wrap(async (req, res) => {
    const { take } = parse(z.object({ take: z.boolean() }).strict(), req.body);
    const result = await db.runTransaction(async (tx) => {
      const ref = db.doc(`sessions/${req.params.roomId}`), room = await tx.get(ref); requireOpenRoom(room);
      const own = await tx.get(ref.collection('members').doc(req.ctx.uid));
      if (own.get('role') !== 'participant' || own.get('status') !== 'active' || !Number.isInteger(own.get('group'))) throw new HttpError(403, 'participant_only', '所属グループを確認してください');
      if (room.get('recording') === false) throw new HttpError(403, 'recording_disabled', 'この部屋では録音しません');
      if (room.get('endedAt') || room.get('phase') === 'closed') throw new HttpError(409, 'discussion_ended', 'ディスカッションは終了しました');
      const group = own.get('group') as number, groupRef = ref.collection('groups').doc(String(group)), config = await tx.get(groupRef);
      const current = config.get('recorderUid') as string | null | undefined;
      if (take) {
        if (current && current !== req.ctx.uid) throw new HttpError(409, 'recorder_taken', `${config.get('recorderName') ?? '別の参加者'}さんの端末が録音を担当しています`);
        tx.set(groupRef, { groupId: String(group), number: group, name: config.get('name') ?? `グループ${group}`, recorderUid: req.ctx.uid, recorderName: recorderName(own) }, { merge: true });
        return { recorderUid: req.ctx.uid };
      }
      if (current === req.ctx.uid) tx.set(groupRef, { recorderUid: null, recorderName: null }, { merge: true });
      return { recorderUid: current === req.ctx.uid ? null : current ?? null };
    });
    res.json(result);
  }));
  app.post('/rooms/:roomId/groups/delete', authenticate, member, host, wrap(async (req, res) => {
    const { group } = parse(z.object({ group: groupId }).strict(), req.body);
    await db.runTransaction(async (tx) => {
      const ref = db.doc(`sessions/${req.params.roomId}`), room = await tx.get(ref); requireOpenRoom(room);
      const members = await tx.get(ref.collection('members').where('group', '==', group).limit(1));
      if (room.get('phase') !== 'collecting' || group !== room.get('groups') || group <= 1 || !members.empty || statusOf(room, group) !== 'opinions') throw new HttpError(409, 'group_not_empty', '開始前の最後の空グループだけ削除できます');
      tx.delete(ref.collection('groups').doc(String(group))); tx.update(ref, { groups: group - 1, [`groupState.${group}`]: FieldValue.delete() });
    }); res.json({ ok: true });
  }));
  app.post('/rooms/:roomId/groups/assign', authenticate, member, host, wrap(async (req, res) => {
    const { uid, group } = parse(z.object({ uid: id, group: groupId }).strict(), req.body);
    const previous = await db.runTransaction(async (tx) => {
      const ref = db.doc(`sessions/${req.params.roomId}`), room = await tx.get(ref), target = await tx.get(ref.collection('members').doc(uid)); requireOpenRoom(room);
      if (target.get('role') !== 'participant' || target.get('status') !== 'active' || group > room.get('groups')) throw new HttpError(400, 'invalid_member', '参加者とグループを確認してください');
      if (statusOf(room, group) !== 'opinions' || (target.get('group') && statusOf(room, target.get('group')) !== 'opinions')) throw new HttpError(409, 'group_started', '開始後はグループを変更できません');
      tx.update(target.ref, { group, groupId: String(group) });
      return target.get('group') as number | undefined;
    });
    if (previous && previous !== group) await refreshGroup(req.params.roomId, previous);
    await refreshGroup(req.params.roomId, group);
    res.json({ ok: true });
  }));
  app.get('/rooms/:roomId/results/:resultId', authenticate, member, wrap(async (req, res) => {
    const resultId = parse(id, req.params.resultId), path = `sessions/${req.params.roomId}`;
    const [room, own] = await db.getAll(db.doc(path), db.doc(`${path}/members/${req.ctx.uid}`));
    if (!mayReadResult(resultId, req.ctx.role === 'host', own.get('group') ?? 0, room.get('resultsPublished') === true)) throw new HttpError(403, 'result_not_published', '所属グループの公開済み結果だけ閲覧できます');
    const result = await db.doc(`${path}/results/${resultId}`).get();
    if (!result.exists) throw new HttpError(404, 'result_not_found', '結果がありません');
    res.json(wireData(result.data()));
  }));
}
