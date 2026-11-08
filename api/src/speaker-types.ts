export interface VoiceProfile { uid: string; label: string; embedding: number[] }
export function matchSpeaker(vector: number[] | null, profiles: VoiceProfile[], minimum = 0.5, margin = 0.08) {
  if (!vector || !profiles.length) return { uid: null, confidence: null };
  const ranked = profiles.map((p) => ({ uid: p.uid, score: cosine(vector, p.embedding) })).sort((a,b) => b.score - a.score);
  const first = ranked[0], second = ranked[1]?.score ?? -1;
  return { uid: first.score >= minimum && first.score - second >= margin ? first.uid : null, confidence: first.score };
}
/** 短い区間が曖昧な場合だけ直近の文脈を使い、別の声を前の話者へ引きずらない。 */
export function matchContextSpeaker(current: number[] | null, context: number[] | null, profiles: VoiceProfile[]) {
  const direct = matchSpeaker(current, profiles);
  if (direct.uid || !current || !context) return direct;
  const extended = matchSpeaker(context, profiles);
  if (!extended.uid) return direct;
  const ranked = [...profiles].sort((a, b) => cosine(current, b.embedding) - cosine(current, a.embedding));
  const closest = ranked[0];
  const separated = !ranked[1] || cosine(current, closest.embedding) - cosine(current, ranked[1].embedding) >= 0.02;
  return separated && closest?.uid === extended.uid ? extended : direct;
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

/** セッション内の匿名話者。曖昧な区間では新しい話者を増やさない。 */
export function partitionSpeaker(vector: number[] | null, profiles: VoiceProfile[], maximum = 100) {
  if (!vector?.length || vector.some(v => !Number.isFinite(v)) || Math.hypot(...vector) === 0)
    return { uid: null, confidence: null };
  if (profiles.length && profiles[0].embedding.length !== vector.length) return { uid: null, confidence: null };
  const match = matchSpeaker(vector, profiles, 0.6, 0.1);
  if (match.uid) return match;
  // 既存話者にある程度似ている声・混ざった声は、無理に別人へ割り当てない。
  const closest = profiles.length ? Math.max(...profiles.map(p => cosine(vector, p.embedding))) : -1;
  if (closest > 0.35 || profiles.length >= maximum) return match;
  const index = profiles.length;
  const uid = `anonymous-${index + 1}`;
  let letter = '', number = index + 1;
  while (number) { number--; letter = String.fromCharCode(65 + number % 26) + letter; number = Math.floor(number / 26); }
  const norm = Math.hypot(...vector);
  profiles.push({ uid, label: `話者${letter}`, embedding: vector.map(v => v / norm) });
  return { uid, confidence: null };
}
