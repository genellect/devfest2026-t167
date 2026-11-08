import { randomUUID } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Dependencies } from './dependencies.js';
import type { Discussion } from './gemini.js';
import { HttpError, requireOpenRoom } from './http.js';
import { participantGroup } from './membership.js';
import { roomTransaction } from './room-transaction.js';
import { validateAudio } from './audio.js';
import { trackJob } from './job-events.js';
import { updateDiscussionSummary } from './discussion-results.js';
import { ANALYZE_COOLDOWN_MS, MAX_RECORDING_ATTEMPTS, RECORDING_TIMEOUT_MS, statusOf } from './policy.js';

interface Input { roomId: string; uid: string; audio: Buffer; mimeType: string; durationSec: number; fingerprint: string }
interface Analysis { result: Discussion; durationSec: number }

/** 別端末の録音を1本の時系列として扱わず、端末ごとの分析をまとめて表示する。 */
function combine(rows: Analysis[]): Discussion {
  const unique = <T>(values: T[]) => [...new Map(values.map(value => [JSON.stringify(value), value])).values()].slice(0, 100);
  const moments = (key: 'good' | 'review') => rows.flatMap((row, i) => row.result[key].map(moment => ({ ...moment, at: `端末${i + 1} ${moment.at}` })));
  const behavior = (key: keyof Discussion['behaviors']) => unique(rows.flatMap((row, i) => row.result.behaviors[key].map(moment => ({ ...moment, at: `端末${i + 1} ${moment.at}` }))));
  return {
    speechDetected: rows.some(row => row.result.speechDetected),
    totalMinutes: Math.round(Math.max(...rows.map(row => row.durationSec)) / 6) / 10,
    segments: [],
    flowNote: rows.map((row, i) => `端末${i + 1}：${row.result.flowNote}`).join('\n\n').slice(0, 40000),
    good: unique(moments('good')), review: unique(moments('review')),
    behaviors: { questions: behavior('questions'), responses: behavior('responses'), reasoning: behavior('reasoning'), collaboration: behavior('collaboration') },
    teacherSuggestions: unique(rows.flatMap(row => row.result.teacherSuggestions)),
  };
}

/** 各自端末は本人単位で受領・排他・再送を管理する。原音をDBに保存しない。 */
export async function analyzePersonalRecording(deps: Dependencies, input: Input) {
  const { db, now, gemini } = deps;
  const { roomId, uid, audio, mimeType, durationSec, fingerprint } = input;
  const roomRef = db.doc(`sessions/${roomId}`), memberRef = roomRef.collection('members').doc(uid);
  const uploadRef = roomRef.collection('recordingUploads').doc(uid), jobId = randomUUID();
  const access = async (tx: FirebaseFirestore.Transaction) => {
    const room = await tx.get(roomRef); requireOpenRoom(room);
    const group = await participantGroup(tx, room, uid);
    const [config, member, upload] = await tx.getAll(roomRef.collection('groups').doc(String(group)), memberRef, uploadRef);
    if (config.get('recordingMode') !== 'personal' || member.get('deviceMode') !== 'personal') throw new HttpError(403, 'recording_not_allowed', '各自端末の録音方式と参加状態を確認してください');
    if (upload.exists && upload.get('group') !== group) throw new HttpError(409, 'group_changed', '録音時のグループと現在の所属が異なります');
    if (room.get('recording') === false) throw new HttpError(403, 'recording_disabled', '録音しないセッションです');
    if (room.get('endedAt') instanceof Timestamp && now() > room.get('endedAt').toMillis() + 5 * 60_000) throw new HttpError(409, 'upload_window_closed', '録音の受付時間を過ぎました');
    if (!['discussing', 'consensus', 'done'].includes(statusOf(room, group))) throw new HttpError(409, 'wrong_phase', '議論開始後に送信してください');
    return { room, group, upload };
  };
  const cached = await roomTransaction(db, roomId, async tx => {
    const { upload } = await access(tx);
    return upload.get('status') === 'done' && upload.get('fingerprint') === fingerprint ? upload.get('receipt') : undefined;
  });
  if (cached) return cached;
  await validateAudio(audio, mimeType, durationSec);
  const claimed = await roomTransaction(db, roomId, async tx => {
    const { room, group, upload } = await access(tx), state = upload.data() ?? {};
    if (state.status === 'done' && state.fingerprint === fingerprint) return { receipt: state.receipt, group, room };
    if (state.status === 'done') throw new HttpError(409, 'already_analyzed', 'この端末の録音は分析済みです');
    if (state.status === 'analyzing' && now() - state.startedAt.toMillis() < RECORDING_TIMEOUT_MS) throw new HttpError(409, 'analysis_in_progress', 'この端末の録音を分析しています');
    if ((state.attempts ?? 0) >= MAX_RECORDING_ATTEMPTS) throw new HttpError(429, 'too_many_attempts', 'この端末の録音分析の試行上限です');
    const wait = state.status === 'failed' ? ANALYZE_COOLDOWN_MS - (now() - state.failedAt.toMillis()) : 0;
    if (wait > 0) throw new HttpError(429, 'cooldown', `あと${Math.ceil(wait / 1000)}秒待ってください`, { retryAfterSec: Math.ceil(wait / 1000) });
    tx.set(uploadRef, { group, status: 'analyzing', jobId, fingerprint, startedAt: Timestamp.fromMillis(now()), attempts: (state.attempts ?? 0) + 1 });
    tx.update(memberRef, { recordingStatus: 'analyzing' });
    tx.set(roomRef, { groupState: { [group]: { recording: { status: 'analyzing' } } } }, { merge: true });
    return { group, room };
  });
  if (claimed.receipt) return claimed.receipt;
  const { group, room } = claimed;
  let result: Discussion;
  try {
    result = await trackJob(deps, 'recording', jobId, () => gemini.analyzeDiscussion({ audio, mimeType, durationSec, theme: room.get('theme') || room.get('title') || '' }));
  } catch {
    await roomTransaction(db, roomId, async tx => {
      const current = await tx.get(roomRef), upload = await tx.get(uploadRef);
      if (!current.exists || current.get('phase') === 'closed' || upload.get('jobId') !== jobId) return;
      tx.update(uploadRef, { status: 'failed', failedAt: Timestamp.fromMillis(now()) });
      tx.update(memberRef, { recordingStatus: 'failed' });
      tx.set(roomRef, { groupState: { [group]: { recording: { status: 'failed' } } } }, { merge: true });
    });
    throw new HttpError(503, 'gemini_unavailable', '録音の分析を再試行してください');
  }
  const response = { group, status: 'done', speechDetected: result.speechDetected, totalMinutes: result.totalMinutes, source: gemini.source };
  const saved = await roomTransaction(db, roomId, async tx => {
    const current = await tx.get(roomRef), upload = await tx.get(uploadRef), member = await tx.get(memberRef);
    if (!current.exists || current.get('phase') === 'closed' || current.get('deleting') || upload.get('jobId') !== jobId || member.get('status') !== 'active' || member.get('group') !== group) return false;
    const [uploads, members] = await Promise.all([
      tx.get(roomRef.collection('recordingUploads').where('group', '==', group)),
      tx.get(roomRef.collection('members').where('group', '==', group)),
    ]);
    const active = new Set(members.docs.filter(m => m.get('status') === 'active').map(m => m.id));
    const others = uploads.docs.filter(d => d.id !== uid && active.has(d.id));
    const rows = [...others.filter(d => d.get('status') === 'done').map(d => ({ result: d.get('result') as Discussion, durationSec: d.get('durationSec') as number })), { result, durationSec }];
    const pending = others.some(d => d.get('status') === 'analyzing'), failed = others.some(d => d.get('status') === 'failed');
    tx.update(uploadRef, { status: 'done', result, durationSec, receipt: response, updatedAt: FieldValue.serverTimestamp() });
    tx.update(memberRef, { recordingStatus: 'done' });
    tx.set(roomRef.collection('results').doc(`flow-g${group}`), { group, ...combine(rows), durationSec: Math.round(Math.max(...rows.map(row => row.durationSec))), source: gemini.source, recordingMode: 'personal', recordingCount: rows.length, updatedAt: FieldValue.serverTimestamp() });
    tx.set(roomRef, { groupState: { [group]: { recording: { status: pending ? 'analyzing' : failed ? 'failed' : 'done' } } } }, { merge: true });
    return true;
  });
  if (!saved) throw new HttpError(409, 'stale_result', '参加状態または録音の送信状態が変わりました');
  await updateDiscussionSummary(deps, roomId);
  return response;
}
