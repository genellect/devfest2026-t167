import { expect, it } from 'vitest';
import { selfSpeakingView } from '../../src/speaking-view.js';
import type { SpeakingState } from '../../src/speaker-routes.js';

const state: SpeakingState = {
  group: 1, source: 'mock', version: 'v', processedMs: 120_000, unknownMs: 2000, updatedAt: 0,
  talkMs: { me: 6000, other: 12_000 }, members: [{ uid: 'me', label: '本人' }, { uid: 'other', label: 'ほかの人' }],
  latest: { uid: 'other', label: 'ほかの人', confidence: 0.9 },
  timeline: [{ talkMs: { me: 1000, other: 8000 }, unknownMs: 1000 }, { talkMs: { me: 5000, other: 4000 }, unknownMs: 1000 }],
};

it('本人の時間と、分母になるグループ全体の時間だけを渡し、ほかの人の名前・時間・直近の発言者を出さない', () => {
  const view = selfSpeakingView(state, ['me']);
  expect(view.members).toEqual([{ uid: 'me', label: '本人' }]);
  expect(view.talkMs).toEqual({ me: 6000 });
  expect(view.totalMs).toBe(20_000);
  expect(view.timeline).toEqual([{ talkMs: { me: 1000 }, unknownMs: 0, totalMs: 10_000 }, { talkMs: { me: 5000 }, unknownMs: 0, totalMs: 10_000 }]);
  expect(JSON.stringify(view)).not.toMatch(/other|ほかの人|latest|confidence/);
});

it('共有端末では、その端末で登録した全員を本人として扱う', () => {
  expect(selfSpeakingView(state, ['me', 'other']).members).toHaveLength(2);
});

it('本人が話者として登録されていなければ、本人の行は空になる', () => {
  const view = selfSpeakingView(state, ['someone']);
  expect(view.members).toEqual([]); expect(view.talkMs).toEqual({});
});
