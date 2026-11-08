/**
 * 各自端末（複数の端末が同じグループの同じ1秒を聞く）での発言時間の集計。
 * 同じ秒について、話者ごとの最大値だけを数える。「話者不明」は、その秒に既に数えた時間を超える分だけを数え、
 * 後から別の端末が話者を特定できたら、不明として数えた分をその話者へ移す（遠い端末の「不明」で二重に数えない）。
 */
export interface SpeechBucket { known: Record<string, number>; unknown: number }
export interface SpeechDelta { talk: Record<string, number>; unknown: number; bucket: SpeechBucket }

export function emptyBucket(): SpeechBucket { return { known: {}, unknown: 0 }; }

export function acceptSpeech(previous: SpeechBucket | undefined, uid: string | null, speechMs: number): SpeechDelta {
  const bucket: SpeechBucket = { known: { ...(previous?.known ?? {}) }, unknown: previous?.unknown ?? 0 };
  const ms = Math.max(0, Math.min(1000, speechMs));
  if (uid) {
    const before = bucket.known[uid] ?? 0, added = Math.max(0, ms - before);
    bucket.known[uid] = Math.max(before, ms);
    const reclaimed = Math.min(bucket.unknown, added);
    bucket.unknown -= reclaimed;
    return { talk: added ? { [uid]: added } : {}, unknown: reclaimed ? -reclaimed : 0, bucket };
  }
  const counted = Math.max(bucket.unknown, ...Object.values(bucket.known), 0);
  const added = Math.max(0, ms - counted);
  bucket.unknown += added;
  return { talk: {}, unknown: added, bucket };
}
