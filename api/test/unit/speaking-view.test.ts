import { expect, it } from 'vitest';
import { selfSpeakingView } from '../../src/speaking-view.js';
import type { SpeakingState } from '../../src/speaker-routes.js';

const state: SpeakingState = {
  group: 1, source: 'mock', version: 'v', processedMs: 120_000, unknownMs: 2000, updatedAt: 0,
  talkMs: { me: 6000, other: 12_000 }, members: [{ uid: 'me', label: '本人' }, { uid: 'other', label: 'ほかの人' }],
  latest: { uid: 'other', label: 'ほかの人', confidence: 0.9 },
  timeline: [{ talkMs: { me: 1000, other: 8000 }, unknownMs: 1000 }, { talkMs: { me: 5000, other: 4000 }, unknownMs: 1000 }],
};

it('2人のグループでは、本人の時間と分母だけを渡し、相手の時間・名前・直近の発言者を出さない', () => {
  const view = selfSpeakingView(state, ['me']);
  expect(view.members).toEqual([{ uid: 'me', label: '本人' }]);
  expect(view.talkMs).toEqual({ me: 6000 });
  expect(view.totalMs).toBe(20_000); expect(view.memberCount).toBe(2);
  // ほかのメンバーが1人だけのときは、線がそのまま相手の推移になるので othersMs を渡さない
  expect(view.timeline).toEqual([{ talkMs: { me: 1000 }, unknownMs: 0, totalMs: 10_000 }, { talkMs: { me: 5000 }, unknownMs: 0, totalMs: 10_000 }]);
  expect(JSON.stringify(view)).not.toMatch(/"other"|ほかの人|latest|confidence|othersMs/);
});

it('ほかのメンバーが2人以上なら、名前とIDを外し、議論全体の発言時間の多い順に渡す', () => {
  const three: SpeakingState = {
    ...state, talkMs: { me: 6000, a: 3000, b: 9000 },
    members: [{ uid: 'me', label: '本人' }, { uid: 'a', label: '名簿で先の人' }, { uid: 'b', label: '名簿で後の人' }],
    timeline: [{ talkMs: { me: 1000, a: 2000, b: 4000 }, unknownMs: 0 }, { talkMs: { me: 5000, a: 1000, b: 5000 }, unknownMs: 0 }],
  };
  const view = selfSpeakingView(three, ['me']);
  // 名簿の順（a, b）ではなく、多い順（b, a）
  expect(view.timeline.map((m) => m.othersMs)).toEqual([[4000, 2000], [5000, 1000]]);
  expect(JSON.stringify(view)).not.toMatch(/"a"|"b"|名簿/);
});

it('共有端末では、その端末で登録した全員を本人として扱う', () => {
  expect(selfSpeakingView(state, ['me', 'other']).members).toHaveLength(2);
});

it('本人が話者として登録されていなければ、本人の行は空になる', () => {
  const view = selfSpeakingView(state, ['someone']);
  expect(view.members).toEqual([]); expect(view.talkMs).toEqual({});
});

it('項目が欠けた古い文書でも例外にせず、空の集計を返す', () => {
  const view = selfSpeakingView({ group: 1 }, ['me']);
  expect(view).toMatchObject({ scope: 'self', members: [], talkMs: {}, totalMs: 0, memberCount: 0, timeline: [] });
});
