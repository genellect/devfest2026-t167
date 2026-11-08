import { describe, expect, it } from 'vitest';
import { addToTimeline } from '../../src/speaker-routes.js';

describe('発言率の推移（1分ごとの発話時間）', () => {
  it('録音開始から何分目かで区切り、話者ごとと判別不能に分けて足す', () => {
    let t = addToTimeline(undefined, 0, 'a', 800);
    t = addToTimeline(t, 1000, null, 300);
    t = addToTimeline(t, 59_000, 'a', 200);
    expect(t).toEqual([{ talkMs: { a: 1000 }, unknownMs: 300 }]);
    t = addToTimeline(t, 60_000, 'b', 500);
    expect(t[1]).toEqual({ talkMs: { b: 500 }, unknownMs: 0 });
  });
  it('発話のなかった分も0で埋め、無音の区間では何も足さない', () => {
    const t = addToTimeline([], 180_000, null, 0);
    expect(t).toHaveLength(4);
    expect(t.every((m) => m.unknownMs === 0 && !Object.keys(m.talkMs).length)).toBe(true);
  });
  it('元の配列を書き換えない', () => {
    const before = [{ talkMs: { a: 100 }, unknownMs: 0 }];
    addToTimeline(before, 0, 'a', 100);
    expect(before[0].talkMs.a).toBe(100);
  });
});
