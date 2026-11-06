import { beforeEach, describe, expect, it, vi } from 'vitest';

// Vertex AI には接続しない。GoogleGenAI を、渡された設定を記録する偽物に差し替える
let responseBody: unknown;
beforeEach(() => { responseBody = undefined; });
const calls: { init: unknown; req: { model: string; config: Record<string, unknown> } }[] = [];
vi.mock('@google/genai', async (importOriginal) => {
  const real = await importOriginal<typeof import('@google/genai')>();
  class FakeGenAI {
    constructor(readonly init: unknown) {}
    models = {
      generateContent: async (req: { model: string; config: Record<string, unknown> }) => {
        calls.push({ init: this.init, req });
        return { text: JSON.stringify(responseBody ?? { points: [{ summary: '論点', discussed: false }] }) };
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

describe('AI応答の参照整合性', () => {
  it('範囲外・重複・欠落・不明な提案IDを拒否する', async () => {
    const { validateComparison } = await import('../../src/gemini.js');
    const comparison = (members: number[], ids: string[] = []) => ({ groups: [{ label: '合意', members }], addressedInsightIds: ids });
    expect(validateComparison(comparison([0, 1], ['ok']), 2, ['ok'])).toBeDefined();
    for (const value of [comparison([0, 2]), comparison([0, 0]), comparison([0]), comparison([0, 1], ['unknown']), comparison([0, 1], ['ok', 'ok'])]) {
      expect(() => validateComparison(value, 2, ['ok'])).toThrow();
    }
  });
});

describe('実SDK接続部分のモック検査', () => {
  it('合意分析の入力と出力の対応を検査する', async () => {
    responseBody = { groups: [{ label: '同じ意味', members: [0] }], addressedInsightIds: ['known'] };
    const result = await vertexGemini('p', 'global', 'gemini-3.5-flash').compare(['一文'], [{ id: 'known', summary: '論点' }], ['発言']);
    expect(result).toMatchObject(responseBody);
    expect(calls.at(-1)!.req.config).toMatchObject({ httpOptions: { retryOptions: { attempts: 1 } } });
    responseBody = { groups: [{ label: '不正', members: [9] }], addressedInsightIds: [] };
    await expect(vertexGemini('p', 'global', 'gemini-3.5-flash').compare(['一文'], [], [])).rejects.toThrow('invalid_comparison_partition');
  });
  it('音声のSDK要求と応答スキーマをモックで確認する', async () => {
    const { mockGemini } = await import('../../src/gemini.js');
    responseBody = await mockGemini().analyzeDiscussion({ audio: Buffer.alloc(1), mimeType: 'audio/wav', durationSec: 60, theme: '架空のテーマ' });
    const result = await vertexGemini('p', 'global', 'gemini-3.5-flash').analyzeDiscussion({ audio: Buffer.alloc(1), mimeType: 'audio/wav', durationSec: 60, theme: '架空のテーマ' });
    expect(result).toMatchObject(responseBody);
    expect(calls.at(-1)!.req.config.abortSignal).toBeInstanceOf(AbortSignal);
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
