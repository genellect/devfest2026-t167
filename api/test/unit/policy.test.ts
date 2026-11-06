import { describe, expect, it } from 'vitest';
import { PHASES, canSubmitStatement, groupNumber, nextGroupState, messageCounts } from '../../src/policy.js';
describe('進行の境界', () => {
  it.each(PHASES)('フェーズ %s と全グループ状態の提出許可', (phase) => {
    for (const state of ['opinions', 'discussing', 'consensus', 'done']) {
      expect(canSubmitStatement(phase, state)).toBe(phase !== 'closed' && state !== 'done' && (phase === 'consensus' || state === 'consensus'));
    }
  });
  it('空グループや未提出は開始せず、全員提出または先生の開始でだけ進む', () => {
    expect(nextGroupState('opinions', 0, 0, true)).toBe('opinions');
    expect(nextGroupState('opinions', 3, 2)).toBe('opinions');
    expect(nextGroupState('opinions', 3, 3)).toBe('discussing');
    expect(nextGroupState('opinions', 3, 0, true)).toBe('discussing');
    expect(nextGroupState('done', 3, 3, true)).toBe('done');
  });
  it('旧形式の1グループと範囲外・非整数を区別する', () => {
    const member = (group?: unknown) => ({ get: () => group });
    expect(groupNumber(member(), undefined)).toBe(1);
    expect(groupNumber(member(), 2)).toBeUndefined();
    for (const value of [0, -1, 3, 1.5, '1']) expect(groupNumber(member(value), 2)).toBeUndefined();
  });
  it('発言は1巡で集計し、未発言も0にする', () => {
    expect(messageCounts(['a', 'b', 'c'], ['a', 'b', 'a', 'outside'])).toEqual([2, 1, 0]);
  });
});
