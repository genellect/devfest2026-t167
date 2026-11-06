import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpError, requireOpenRoom } from './http.js';
import { ANALYSIS_PHASES, ANALYZE_COOLDOWN_MS, RUNNING_TIMEOUT_MS } from './policy.js';
import type { Dependencies } from './dependencies.js';
export function createAnalysisJobs({ db, now }: Dependencies) {
  const roomRef = (id: string) => db.doc(`sessions/${id}`);
  const analysisPhases = ANALYSIS_PHASES;
  type AnalysisField = keyof typeof analysisPhases;
  async function beginAnalysis(roomId: string, field: AnalysisField) {
    const jobId = randomUUID();
    const groups = await db.runTransaction(async (tx) => {
      const room = await tx.get(roomRef(roomId));
      requireOpenRoom(room);
      if (!analysisPhases[field].includes(room.get('phase'))) throw new HttpError(409, 'wrong_phase', 'このフェーズでは分析できません');
      const analysis = room.get(field) ?? {};
      const started = analysis.startedAt instanceof Timestamp ? analysis.startedAt.toMillis() : 0;
      if (analysis.status === 'running' && now() - started < RUNNING_TIMEOUT_MS) throw new HttpError(409, 'analysis_in_progress', '分析中です');
      const wait = ANALYZE_COOLDOWN_MS - (now() - started);
      if (wait > 0) throw new HttpError(429, 'cooldown', `あと ${Math.ceil(wait / 1000)} 秒待ってください`, { retryAfterSec: Math.ceil(wait / 1000) });
      tx.update(room.ref, { [field]: { status: 'running', jobId, startedAt: Timestamp.fromMillis(now()) } });
      return room.get('groups') as number | undefined;
    });
    return { jobId, groups };
  }
  // 状態変更や期限切れ後の再実行と競合した古い結果・エラーは保存しない。
  const finishAnalysis = (roomId: string, field: AnalysisField, jobId: string, write: (tx: FirebaseFirestore.Transaction) => void) =>
    db.runTransaction(async (tx) => {
      const room = await tx.get(roomRef(roomId));
      if (!analysisPhases[field].includes(room.get('phase')) || room.get(`${field}.jobId`) !== jobId) return false;
      write(tx);
      return true;
    });
  return { beginAnalysis, finishAnalysis };
}
