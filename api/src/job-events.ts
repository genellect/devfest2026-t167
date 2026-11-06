import type { Dependencies } from './dependencies.js';
/** 識別子はランダムなjobIdのみ。入力・結果・利用者・部屋の識別子は渡さない。 */
export async function trackJob<T>(deps: Dependencies, stage: 'points' | 'consensus' | 'group' | 'recording', jobId: string, operation: () => Promise<T>): Promise<T> {
  const started = performance.now();
  const emit = (status: 'started' | 'completed' | 'failed') => {
    try { deps.observe?.({ jobId, stage, status, durationMs: Math.round(performance.now() - started) }); } catch { /* 計測の失敗は本処理に影響させない */ }
  };
  emit('started');
  try { const value = await operation(); emit('completed'); return value; }
  catch (error) { emit('failed'); throw error; }
}
