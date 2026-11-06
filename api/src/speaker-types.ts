export interface VoiceProfile { uid: string; label: string; embedding: number[] }
export function matchSpeaker(vector: number[] | null, profiles: VoiceProfile[], minimum = 0.5, margin = 0.08) {
  if (!vector || !profiles.length) return { uid: null, confidence: null };
  const ranked = profiles.map((p) => ({ uid: p.uid, score: cosine(vector, p.embedding) })).sort((a,b) => b.score - a.score);
  const first = ranked[0], second = ranked[1]?.score ?? -1;
  return { uid: first.score >= minimum && first.score - second >= margin ? first.uid : null, confidence: first.score };
}
export function cosine(a: number[], b: number[]) {
  if (a.length !== b.length || !a.length || [...a, ...b].some((v) => !Number.isFinite(v))) return -1;
  const aa = Math.hypot(...a), bb = Math.hypot(...b);
  return aa && bb ? a.reduce((sum, v, i) => sum + v*b[i], 0) / aa / bb : -1;
}
export function participation(talkMs: Record<string, number>, unknownMs: number) {
  const total = Object.values(talkMs).reduce((a,b) => a+b, 0) + unknownMs;
  return Object.fromEntries(Object.entries(talkMs).map(([uid, ms]) => [uid, total > 0 ? ms / total : null]));
}
