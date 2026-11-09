import { expect, it } from 'vitest';
import { boundDiscussion, mockGemini } from '../../src/gemini.js';
it('短い録音を1分にせず、録音外の時刻を表示しない', async () => {
  const value = await mockGemini().analyzeDiscussion({ audio: Buffer.alloc(1), mimeType: 'audio/wav', durationSec: 60, theme: 'テスト', opinions: ['架空の意見A', '架空の意見B'] });
  value.good.push({ at: '99:99', text: '不正な時刻' });
  const result = boundDiscussion(value, 15);
  expect(result.totalMinutes).toBe(0.25);
  expect(result.segments.reduce((n, s) => n + s.minutes, 0)).toBeCloseTo(0.25);
  expect(result.good).toEqual([{ at: '00:12', text: value.good[0].text }]);
  expect(result.review).toEqual([]); expect(result.behaviors.responses).toEqual([]);
});
it('聞き取れない場合は推測された行動や提案を残さず、区間0分も安全に扱う', async () => {
  const value = await mockGemini().analyzeDiscussion({ audio: Buffer.alloc(1), mimeType: 'audio/wav', durationSec: 60, theme: 'テスト', opinions: ['架空の意見A', '架空の意見B'] });
  const silent = boundDiscussion({ ...value, speechDetected: false }, 5);
  expect(silent).toMatchObject({ speechDetected: false, totalMinutes: 5 / 60, flowNote: '', segments: [], good: [], review: [], teacherSuggestions: [], points: [] });
  const zero = boundDiscussion({ ...value, segments: [{ topic: '本題', minutes: 0 }] }, 5);
  expect(zero.segments[0].minutes).toBe(0);
});
it('論点は録音の外の時刻だけを外して残し、事前の意見の本文を写さない（モック）', async () => {
  const value = await mockGemini().analyzeDiscussion({ audio: Buffer.alloc(1), mimeType: 'audio/wav', durationSec: 60, theme: 'テスト', opinions: ['架空の意見A', '架空の意見B'] });
  expect(value.points).toHaveLength(2);
  expect(value.points.map((p) => p.discussed)).toEqual([true, false]);
  expect(JSON.stringify(value.points)).not.toContain('架空の意見');
  const result = boundDiscussion({ ...value, points: [{ summary: '論点', discussed: true, at: '99:00' }, ...value.points] }, 60);
  expect(result.points[0]).toEqual({ summary: '論点', discussed: true });
  expect(result.points[1].at).toBe(value.points[0].at);
});
