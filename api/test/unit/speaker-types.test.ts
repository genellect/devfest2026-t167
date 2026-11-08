import { expect, it } from 'vitest';
import { cosine, matchSpeaker, matchContextSpeaker, participation, partitionSpeaker, type VoiceProfile } from '../../src/speaker-types.js';
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
it('未登録の声をA/B/Cに分け、同じ声は同じラベルに戻し、曖昧な声は不明に残す', () => {
  const profiles: VoiceProfile[] = [];
  expect(partitionSpeaker([1, 0, 0], profiles).uid).toBe('anonymous-1');
  expect(partitionSpeaker([0, 1, 0], profiles).uid).toBe('anonymous-2');
  expect(partitionSpeaker([0, 0, 1], profiles).uid).toBe('anonymous-3');
  expect(partitionSpeaker([0.99, 0.01, 0], profiles).uid).toBe('anonymous-1');
  expect(partitionSpeaker([1, 1, 0], profiles).uid).toBeNull();
  for (const vector of [null, [], [0, 0, 0], [NaN, 0, 0]]) expect(partitionSpeaker(vector, profiles).uid).toBeNull();
  expect(profiles.map(p => p.label)).toEqual(['話者A', '話者B', '話者C']);
  expect(partitionSpeaker([-1, 0, 0], profiles, 3).uid).toBeNull();
  expect(profiles).toHaveLength(3);
});
it('判別不能を分母に残し、無音だけの場合はデータなしとする', () => {
  expect(participation({ a: 1000, b: 2000 }, 1000)).toEqual({ a: 0.25, b: 0.5 });
  expect(participation({ a: 0 }, 0)).toEqual({ a: null });
});
it('参加上限100人まで匿名ラベルを作り、26人以降も重複しない',()=>{
  const profiles:VoiceProfile[]=[];
  for(let i=0;i<100;i++)expect(partitionSpeaker(Array.from({length:101},(_,j)=>j===i?1:0),profiles).uid).toBe(`anonymous-${i+1}`);
  expect(profiles[26].label).toBe('話者AA');expect(new Set(profiles.map(p=>p.label)).size).toBe(100);
  expect(partitionSpeaker(Array.from({length:101},(_,j)=>j===100?1:0),profiles).uid).toBeNull();
});

it('短い発話の候補が一致する場合だけ文脈で補い、別話者・同点・声なしは割り当てない', () => {
  const profiles = [{ uid: 'a', label: 'A', embedding: [1, 0, 0] }, { uid: 'b', label: 'B', embedding: [0, 1, 0] }];
  expect(matchSpeaker([0.45, 0.3, 0.8], profiles).uid).toBeNull();
  expect(matchContextSpeaker([0.45, 0.3, 0.8], [1, 0, 0], profiles).uid).toBe('a');
  expect(matchContextSpeaker([0.3, 0.45, 0.8], [1, 0, 0], profiles).uid).toBeNull();
  expect(matchContextSpeaker([1, 1, 0], [1, 0, 0], profiles).uid).toBeNull();
  expect(matchContextSpeaker(null, [1, 0, 0], profiles).uid).toBeNull();
  expect(matchContextSpeaker([1, 0, 0], [0, 1, 0], profiles).uid).toBe('a');
});
