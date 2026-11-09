import { expect, it } from 'vitest';
import { validateLiveOverview } from '../../src/live-overview.js';
import { mockGemini } from '../../src/gemini.js';
it('入力にない番号・重複を除外し、長さと件数を制限する', () => {
  const result = validateLiveOverview({ groups: [{ group: 1, focus: '軸'.repeat(100), points: ['観点', '観点', '別の観点', '3', '4'] }, { group: 1, focus: '重複', points: [] }, { group: 2, focus: '不明', points: [] }], suggestions: [{ kind: 'new_angle', summary: '切り口' }, { kind: 'new_angle', summary: '切り口' }] }, [1]);
  expect(result.groups).toHaveLength(1); expect(result.groups[0].focus.length).toBe(80); expect(result.groups[0].points).toEqual(['観点', '別の観点', '3']); expect(result.suggestions).toHaveLength(1);
});
it('不正な種別・空の要約・不正な番号は拒否する', () => {
  expect(() => validateLiveOverview({ groups: [{ group: 0, focus: '軸', points: [] }], suggestions: [] }, [1])).toThrow();
  expect(() => validateLiveOverview({ groups: [], suggestions: [{ kind: 'fact', summary: ' ' }] }, [1])).toThrow();
});
it('モックでも観点が異なり、入力本文をそのまま写さない', async () => {
  const result = await mockGemini().summarizeGroups({ theme: '学校のAI', groups: [{ group: 1, messages: ['学習と申告の話'] }, { group: 2, messages: ['出典と責任の話'] }, { group: 3, messages: ['端末や費用、公平の話'] }, { group: 4, messages: ['入力本文のマーカー'] }, { group: 5, messages: [] }] });
  expect(result.groups.map(g => g.focus)).toEqual(['学習効果と利用範囲', '情報の信頼性と責任', '誰もが参加できる環境', 'グループ4の議論の軸（デモ）']); expect(JSON.stringify(result)).not.toContain('入力本文のマーカー'); expect(result.suggestions[0].kind).toBe('new_angle');
});
