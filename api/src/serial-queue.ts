import { HttpError } from './http.js';
/** 同一プロセス内の短いDB更新を並べ、Firestoreの競合再試行を減らす。正しさは引き続きDBトランザクションが保証する。 */
export function createSerialQueue(maxPending = 64) {
  const queues = new Map<string, { tail: Promise<unknown>; pending: number }>();
  return async <T>(key: string, operation: () => Promise<T>): Promise<T> => {
    const queue = queues.get(key) ?? { tail: Promise.resolve(), pending: 0 };
    if (queue.pending >= maxPending) throw new HttpError(429, 'room_busy', '同じ部屋の更新が混み合っています。少し待ってください', { retryAfterSec: 1 });
    queue.pending++; queues.set(key, queue);
    const result = queue.tail.catch(() => {}).then(operation);
    queue.tail = result;
    try { return await result; }
    finally { if (--queue.pending === 0) queues.delete(key); }
  };
}
