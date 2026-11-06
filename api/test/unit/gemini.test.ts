import { describe, expect, it, vi } from 'vitest';

// Vertex AI には接続しない。GoogleGenAI を、渡された設定を記録する偽物に差し替える
const calls: { init: unknown; req: { model: string; config: Record<string, unknown> } }[] = [];
vi.mock('@google/genai', async (importOriginal) => {
  const real = await importOriginal<typeof import('@google/genai')>();
  class FakeGenAI {
    constructor(readonly init: unknown) {}
    models = {
      generateContent: async (req: { model: string; config: Record<string, unknown> }) => {
        calls.push({ init: this.init, req });
        return { text: JSON.stringify({ points: [{ summary: '論点', discussed: false }] }) };
      },
    };
  }
  return { ...real, GoogleGenAI: FakeGenAI };
});

const { DISCUSSION_LIMITS, DiscussionSchema, GENERATION_CONFIG, normalizeAt, vertexGemini } = await import('../../src/gemini.js');

describe('Vertex AI への生成の設定', () => {
  it('思考レベルは LOW、temperature は 0、応答は JSON', () => {
    expect(GENERATION_CONFIG.thinkingConfig.thinkingLevel).toBe('LOW');
    expect(GENERATION_CONFIG.temperature).toBe(0);
    expect(GENERATION_CONFIG.responseMimeType).toBe('application/json');
  });
  it('呼び出しに思考レベル・スキーマ・接続先・モデルを渡す', async () => {
    const points = await vertexGemini('p', 'global', 'gemini-3.5-flash').findPoints(['意見'], ['発言']);
    expect(points).toEqual([{ summary: '論点', discussed: false }]);
    const { init, req } = calls.at(-1)!;
    expect(init).toEqual({ vertexai: true, project: 'p', location: 'global' });
    expect(req.model).toBe('gemini-3.5-flash');
    expect(req.config).toMatchObject({ thinkingConfig: { thinkingLevel: 'LOW' }, temperature: 0 });
    expect(req.config.responseSchema).toBeDefined();
  });
});

describe('録音の分析の出力の検証', () => {
  const m = (i: number) => ({ at: `${i}:00`, text: 'ある人が理由を尋ねた' });
  it('件数・長さ・時間が上限を超えても拒否せず、切り詰める（送り直しても同じ失敗にならないように）', () => {
    const many = Array.from({ length: 20 }, (_, i) => m(i));
    const r = DiscussionSchema.parse({
      speechDetected: true, totalMinutes: 500,
      segments: Array.from({ length: 20 }, () => ({ topic: 'あ'.repeat(80), minutes: -3 })),
      flowNote: 'い'.repeat(400), good: many, review: many,
      behaviors: { questions: many, responses: many, reasoning: many, collaboration: many },
      teacherSuggestions: Array.from({ length: 9 }, () => 'う'.repeat(300)),
    });
    expect(r.totalMinutes).toBe(120);
    expect(r.segments).toHaveLength(DISCUSSION_LIMITS.segments);
    expect(r.segments[0]).toMatchObject({ topic: 'あ'.repeat(40), minutes: 0 });
    expect(r.flowNote).toHaveLength(300);
    expect(r.good).toHaveLength(DISCUSSION_LIMITS.good);
    expect(r.behaviors.questions).toHaveLength(DISCUSSION_LIMITS.behaviors);
    expect(r.teacherSuggestions).toHaveLength(DISCUSSION_LIMITS.teacherSuggestions);
    expect(r.teacherSuggestions[0]).toHaveLength(200);
  });
  it('時刻は m:ss にそろえる。時:分:秒は分にまとめ、ほかの形はそのまま残す', () => {
    expect(normalizeAt('6:30')).toBe('6:30');
    expect(normalizeAt('1:02:03')).toBe('62:03');
    expect(normalizeAt(' 12分ごろ ')).toBe('12分ごろ');
  });
  it('必須の項目がない応答は拒否する', () => {
    expect(() => DiscussionSchema.parse({ speechDetected: true })).toThrow();
  });
});

// Zodのメジャー更新でも、AI応答の型を暗黙に変換して受理しないことを固定する。
describe('Zod更新後の応答スキーマ互換性', () => {
  const valid = {
    speechDetected: true, totalMinutes: 1, segments: [], flowNote: '', good: [], review: [],
    behaviors: { questions: [], responses: [], reasoning: [], collaboration: [] }, teacherSuggestions: [],
  };
  it.each([
    { speechDetected: 'true' }, { totalMinutes: '1' },
    { good: [{ at: 10, text: '理由を聞いた' }] }, { teacherSuggestions: [42] },
  ])('型の異なる応答を拒否する: %j', (patch) => {
    expect(DiscussionSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});
