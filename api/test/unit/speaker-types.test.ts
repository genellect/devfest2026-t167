import { expect, it } from 'vitest';
import { cosine, matchSpeaker, participation } from '../../src/speaker-types.js';
import { newSpeechMs } from '../../src/speaker-routes.js';
it('異なる声を照合し、近い候補・未登録・不正な特徴は判別不能にする', () => {
  const profiles = [{ uid: 'a', label: 'A', embedding: [1, 0] }, { uid: 'b', label: 'B', embedding: [0, 1] }];
  expect(matchSpeaker([1, 0], profiles).uid).toBe('a');
  expect(matchSpeaker([0, 1], profiles).uid).toBe('b');
  expect(matchSpeaker([1, 1], profiles).uid).toBeNull();
  expect(matchSpeaker([-1, -1], profiles).uid).toBeNull();
  expect(matchSpeaker(null, profiles).confidence).toBeNull();
  expect(matchSpeaker([1, 0], []).uid).toBeNull();
  for (const other of [[1], [], [NaN, 0], [0, 0]]) expect(cosine([1, 0], other)).toBe(-1);
});
it('判別不能を分母に残し、無音だけの場合はデータなしとする', () => {
  expect(participation({ a: 1000, b: 2000 }, 1000)).toEqual({ a: 0.25, b: 0.5 });
  expect(participation({ a: 0 }, 0)).toEqual({ a: null });
});
it('直近3秒の窓のうち、最後の1秒に入る発話だけを数える', () => {
  const segments = [{ startMs: 0, endMs: 1500 }, { startMs: 2200, endMs: 2600 }, { startMs: 2800, endMs: 3200 }];
  expect(newSpeechMs({ speechMs: 2100, segments }, 3000)).toBe(400 + 200);
  expect(newSpeechMs({ speechMs: 2100, segments: [] }, 3000)).toBe(0);
  expect(newSpeechMs({ speechMs: 900, segments: [{ startMs: 100, endMs: 1000 }] }, 1000)).toBe(900);
  // 区間がない（モック）なら、窓全体の発話を1秒あたりに割り戻す
  expect(newSpeechMs({ speechMs: 3000 }, 3000)).toBe(1000);
  expect(newSpeechMs({ speechMs: 700 }, 1000)).toBe(700);
});
