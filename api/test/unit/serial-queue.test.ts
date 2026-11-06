import { expect, it } from 'vitest';
import { createSerialQueue } from '../../src/serial-queue.js';
it('同じキーだけを直列にし、失敗・飽和のあとも復帰できる', async () => {
  const queue = createSerialQueue(2); let release!: () => void; const order: number[] = [];
  const first = queue('a', async () => { order.push(1); await new Promise<void>((resolve) => { release = resolve; }); throw new Error('failure'); });
  const failed = expect(first).rejects.toThrow('failure');
  const second = queue('a', async () => { order.push(2); return 2; });
  await expect(queue('a', async () => 3)).rejects.toMatchObject({ code: 'room_busy' });
  expect(await queue('b', async () => 9)).toBe(9);
  expect(order).toEqual([1]); release(); await failed;
  expect(await second).toBe(2); expect(order).toEqual([1, 2]);
  expect(await queue('a', async () => 4)).toBe(4);
});
