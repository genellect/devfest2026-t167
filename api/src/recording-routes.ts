import { updateDiscussionSummary } from './discussion-results.js';
import { createAudioAdmission } from './audio-admission.js';
import { trackJob } from './job-events.js';
import express, { type Express } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { HttpError, requireOpenRoom, type Handler } from './http.js';
import { participantGroup } from './membership.js';
import { groupMembers, groupDocuments } from './group-data.js';
import { recordingAnalysisTheme } from './room-visibility.js';
import { validateAudio } from './audio.js';
import { MAX_RECORDING_SEC, MAX_RECORDING_BYTES, MAX_RECORDING_ATTEMPTS, RECORDING_TIMEOUT_MS, AUDIO_TYPES, ANALYZE_COOLDOWN_MS, statusOf } from './policy.js';
import type { Dependencies } from './dependencies.js';
export function registerRecordingRoutes(app: Express, deps: Dependencies, guards: { authenticate: Handler; member: Handler; participantOnly: Handler }) {
  const { db, gemini, now } = deps;
  const { authenticate, member, participantOnly } = guards;
  const chain = (...handlers: Handler[]) => handlers;
  const roomRef = (id: string) => db.doc(`sessions/${id}`);
  const admission = createAudioAdmission();
  const audioBody = express.raw({ type: () => true, limit: MAX_RECORDING_BYTES });
  app.post('/rooms/:roomId/groups/recording', ...chain(authenticate, member, participantOnly, admission.admit, audioBody, admission.handle(async (req, res) => {
    const roomId = req.params.roomId;
    if (req.query.consent !== '1') throw new HttpError(400, 'consent_required', '録音することへのグループ全員の同意を確かめてから送ってください');
    const mimeType = (req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!AUDIO_TYPES.includes(mimeType)) throw new HttpError(415, 'unsupported_audio', 'この形式の録音は分析できません');
    const audio = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (audio.length < 1000) throw new HttpError(400, 'empty_recording', '録音が空です');
    const durationSec = Number(req.query.durationSec);
    if (!Number.isFinite(durationSec) || durationSec <= 0) throw new HttpError(400, 'bad_request', '録音の長さ（durationSec）が要ります');
    if (durationSec > MAX_RECORDING_SEC) throw new HttpError(413, 'recording_too_long', '録音は30分までです');
    const fingerprint = createHash('sha256').update(req.ctx.uid).update(mimeType).update(String(durationSec)).update(audio).digest('hex');
    const cachedReceipt = await db.runTransaction(async (tx) => {
      const room = await tx.get(roomRef(roomId));
      requireOpenRoom(room);
      const group = await participantGroup(tx, room, req.ctx.uid);
      if (room.get('flowVersion') === 1 && room.get('endedAt') instanceof Timestamp && now() - room.get('endedAt').toMillis() > 5 * 60_000) throw new HttpError(409, 'upload_window_closed', '録音の受付時間を過ぎました。端末の録音を保管してください');
      const config = await tx.get(room.ref.collection('groups').doc(String(group)));
      if (config.get('recorderUid') && config.get('recorderUid') !== req.ctx.uid) throw new HttpError(403, 'recording_not_allowed', 'Hostが許可した参加者の端末で録音してください');
      const recording = room.get('groupState')?.[group]?.recording;
      if (recording?.status === 'done' && recording.fingerprint === fingerprint) return recording.receipt;
      if (room.get('recording') === false) throw new HttpError(403, 'recording_disabled', 'この部屋では録音を使用しません');
      if (!['discussing', 'consensus', 'done'].includes(statusOf(room, group))) throw new HttpError(409, 'wrong_phase', '議論開始後に送信してください');
    });
    if (cachedReceipt) { res.json(cachedReceipt); return; }
    await validateAudio(audio, mimeType, durationSec);
    const jobId = randomUUID();
    // 完了済みの同一送信は解析も課金も繰り返さず、保存済みの受領結果を返す。
    const { room, group, receipt, opinions } = await db.runTransaction(async (tx) => {
      const r = await tx.get(roomRef(roomId));
      requireOpenRoom(r);
      const group = await participantGroup(tx, r, req.ctx.uid);
      const config = await tx.get(r.ref.collection('groups').doc(String(group)));
      if (config.get('recorderUid') && config.get('recorderUid') !== req.ctx.uid) throw new HttpError(403, 'recording_not_allowed', 'Hostが許可した参加者の端末で録音してください');
      if (r.get('recording') === false) throw new HttpError(403, 'recording_disabled', 'この部屋では、先生が録音を使わない設定にしています');
      if (!['discussing', 'consensus', 'done'].includes(statusOf(r, group))) throw new HttpError(409, 'wrong_phase', 'グループの議論が始まってから送ってください');
      const rec = r.get('groupState')?.[group]?.recording ?? {};
      if (rec.status === 'done' && rec.fingerprint === fingerprint && rec.receipt) return { room: r, group, receipt: rec.receipt };
      if (rec.status === 'done') throw new HttpError(409, 'already_analyzed', 'このグループの録音は、もう分析が終わっています');
      const started = rec.startedAt instanceof Timestamp ? rec.startedAt.toMillis() : 0;
      if (rec.status === 'analyzing' && now() - started < RECORDING_TIMEOUT_MS) throw new HttpError(409, 'analysis_in_progress', 'このグループの録音を分析しています');
      const attempts = typeof rec.attempts === 'number' ? rec.attempts : 0;
      if (attempts >= MAX_RECORDING_ATTEMPTS) throw new HttpError(429, 'too_many_attempts', `録音の分析は、グループごとに${MAX_RECORDING_ATTEMPTS}回までです`);
      const failed = rec.failedAt instanceof Timestamp ? rec.failedAt.toMillis() : 0;
      const wait = rec.status === 'failed' ? ANALYZE_COOLDOWN_MS - (now() - failed) : 0;
      if (wait > 0) throw new HttpError(429, 'cooldown', `あと ${Math.ceil(wait / 1000)} 秒待ってから送ってください`, { retryAfterSec: Math.ceil(wait / 1000) });
      // 録音と照らし合わせる、このグループの事前の意見（本文は Gemini にだけ渡し、持ち主の ID は渡さない）
      const members = await groupMembers(tx, r, group);
      const opinions = (await groupDocuments(tx, r, 'privateOpinions', members.map((m) => m.id)))
        .map((d) => String(d.get('text') ?? '').trim()).filter(Boolean);
      tx.set(roomRef(roomId), { groupState: { [group]: { recording: { status: 'analyzing', jobId, fingerprint, startedAt: Timestamp.fromMillis(now()), attempts: attempts + 1 } } } }, { merge: true });
      return { room: r, group, opinions };
    });
    if (receipt) { res.json(receipt); return; }
    const finishIfMine = (write: (tx: FirebaseFirestore.Transaction) => void) => db.runTransaction(async (tx) => {
      const current = await tx.get(roomRef(roomId));
      if (current.get('phase') === 'closed' || current.get('groupState')?.[group]?.recording?.jobId !== jobId) return false;
      write(tx);
      return true;
    });
    let result;
    try {
      result = await trackJob(deps, 'recording', jobId, () => gemini.analyzeDiscussion({ audio, mimeType, durationSec, theme: recordingAnalysisTheme(room), opinions: opinions ?? [] }));
    } catch {
      await finishIfMine((tx) => tx.set(roomRef(roomId), { groupState: { [group]: { recording: { status: 'failed', failedAt: Timestamp.fromMillis(now()) } } } }, { merge: true }));
      throw new HttpError(503, 'gemini_unavailable', 'AI の分析は一時停止中です。少し待ってから、もう一度送ってください');
    }
    const response = { group, status: 'done', speechDetected: result.speechDetected, totalMinutes: result.totalMinutes, source: gemini.source };
    // 事前の意見から作った論点は、グループのメンバーにも届く flow-g には入れず、先生だけが読む points-g に分ける
    const { points, ...flow } = result;
    const saved = await finishIfMine((tx) => {
      tx.set(db.doc(`sessions/${roomId}/results/flow-g${group}`), {
        group, ...flow, durationSec: Math.round(durationSec), source: gemini.source, jobId, consentAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(db.doc(`sessions/${roomId}/results/points-g${group}`), {
        group, points, opinions: opinions?.length ?? 0, source: gemini.source, jobId, updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(roomRef(roomId), { groupState: { [group]: { recording: { status: 'done', receipt: response } } } }, { merge: true });
    });
    if (!saved) throw new HttpError(409, 'stale_result', '別の送信の分析が始まったため、この結果は破棄しました');
    await updateDiscussionSummary(deps, roomId);
    res.json(response);
  })));

}
