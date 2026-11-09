import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { HttpError } from './http.js';

/** インスタンスをまたぐ利用者単位の制限。窓ごとに新しい文書を増やさない。 */
export function createLimiter(db: Firestore, now: () => number) {
  return async (uid: string, action: 'create' | 'join' | 'submit' | 'session-login' | 'session-activity' | 'theme-suggest' | 'drive-material' | 'workspace', limit: number, windowMs = 60_000) => {
    const id = createHash('sha256').update(`${uid}:${action}`).digest('hex');
    await db.runTransaction(async (tx) => {
      const ref = db.doc(`apiLimits/${id}`), snap = await tx.get(ref);
      const started = snap.get('started') as number | undefined;
      const reset = started === undefined || now() - started >= windowMs;
      const count = reset ? 0 : (snap.get('count') as number ?? 0);
      if (count >= limit) throw new HttpError(429, 'rate_limited', '操作が多すぎます。少し待ってください', { retryAfterSec: Math.ceil((windowMs - (now() - started!)) / 1000) });
      tx.set(ref, { started: reset ? now() : started, count: count + 1 });
    });
  };
}
