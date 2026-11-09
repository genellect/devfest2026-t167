import { describe, expect, it } from 'vitest';
import { agreementSummary, alignmentRate, interventionEffectiveness, participationFairness, reflectionRate } from '../../src/metrics.js';

describe('指標', () => {
  it('意見の反映率：分母0は null', () => {
    expect(reflectionRate([])).toBeNull();
    expect(reflectionRate([{ discussed: true }, { discussed: false }, { discussed: true }, { discussed: true }])).toBe(0.75);
  });
  it('認識一致度：最大のまとまり / 回答者数、回答2人未満は null', () => {
    expect(alignmentRate([{ members: [0] }], 1)).toBeNull();
    expect(alignmentRate([{ members: [0, 1] }, { members: [2] }], 3)).toBeCloseTo(2 / 3);
    expect(alignmentRate([{ members: [0] }, { members: [1] }, { members: [2] }], 3)).toBeCloseTo(1 / 3);
  });
  it('参加の公平性：全員同数で1、1人だけ発言で低い、発言0件は null', () => {
    expect(participationFairness([3, 3, 3])).toBeCloseTo(1);
    expect(participationFairness([0, 0, 9])!).toBeLessThan(0.5);
    expect(participationFairness([0, 0, 0])).toBeNull();
  });
  it('介入の有効率：承認0件は null', () => {
    expect(interventionEffectiveness(0, 0)).toBeNull();
    expect(interventionEffectiveness(2, 1)).toBe(0.5);
  });
});

describe('納得度の分布と平均', () => {
  it('4人以上なら1〜5の人数と平均を出す', () => {
    expect(agreementSummary([4, 3, 5, 4])).toEqual({ respondents: 4, counts: [0, 0, 1, 2, 1], average: 4 });
  });
  it('3人以下では、自分の値からほかの人の値が分かるので分布も平均も出さない', () => {
    expect(agreementSummary([4, 3, 5])).toEqual({ respondents: 3, counts: null, average: null });
    expect(agreementSummary([4, 3])).toEqual({ respondents: 2, counts: null, average: null });
    expect(agreementSummary([])).toEqual({ respondents: 0, counts: null, average: null });
  });
  it('範囲外・整数でない値は数えない', () => {
    expect(agreementSummary([0, 6, 2.5, '4', null, 1, 2, 3, 2])).toEqual({ respondents: 4, counts: [1, 2, 1, 0, 0], average: 2 });
  });
});
