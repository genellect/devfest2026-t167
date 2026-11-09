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
  it('論点は10件までに切り詰め、論点を含まない古い応答も受け付ける', () => {
    const base = { speechDetected: true, totalMinutes: 1, segments: [], flowNote: '', good: [], review: [], behaviors: { questions: [], responses: [], reasoning: [], collaboration: [] }, teacherSuggestions: [] };
    expect(DiscussionSchema.parse(base).points).toEqual([]);
    const r = DiscussionSchema.parse({ ...base, points: Array.from({ length: 15 }, () => ({ summary: 'え'.repeat(300), discussed: false })) });
    expect(r.points).toHaveLength(DISCUSSION_LIMITS.points);
    expect(r.points[0].summary).toHaveLength(200);
  });
  it('必須の項目がない応答は拒否する', () => {
    expect(() => DiscussionSchema.parse({ speechDetected: true })).toThrow();
  });
});

describe('AI応答の参照整合性', () => {
  it('範囲外・重複・欠落・不明な提案IDを、完全な分割に直して受け取る（同じ入力で失敗し続けない）', async () => {
    const { validateComparison, UNCLASSIFIED_LABEL } = await import('../../src/gemini.js');
    const comparison = (groups: number[][], ids: string[] = []) => ({ groups: groups.map((members, i) => ({ label: `理解${i}`, members })), addressedInsightIds: ids });
    expect(validateComparison(comparison([[0, 1]], ['ok']), 2, ['ok'])).toEqual(comparison([[0, 1]], ['ok']));
    // 範囲外の番号は捨て、漏れた一文は1つずつ別のまとまりにする
    expect(validateComparison(comparison([[0, 2]]), 2, [])).toEqual({ groups: [{ label: '理解0', members: [0] }, { label: UNCLASSIFIED_LABEL, members: [1] }], addressedInsightIds: [] });
    // 重複は最初のまとまりだけに残し、空になったまとまりは消す
    expect(validateComparison(comparison([[0, 0], [0], [1]]), 2, []).groups).toEqual([{ label: '理解0', members: [0] }, { label: '理解2', members: [1] }]);
    expect(validateComparison(comparison([]), 2, []).groups.map((g) => g.members)).toEqual([[0], [1]]);
    // 不明・重複した提案 ID は捨てる
    expect(validateComparison(comparison([[0, 1]], ['unknown', 'ok', 'ok']), 2, ['ok']).addressedInsightIds).toEqual(['ok']);
  });
  it('モックは非公開の事前意見と合意の一文の本文を、要約やラベルに写さない', async () => {
    const { mockGemini } = await import('../../src/gemini.js');
    const secret = '非公開の事前意見の本文マーカー';  // submit-allow: テスト用のダミー
    const points = await mockGemini().findPoints([secret], []);
    expect(JSON.stringify(points)).not.toContain('マーカー');
    const cmp = await mockGemini().compare([`${secret}A`, `${secret}A`, `${secret}B`], [], []);
    expect(cmp.groups.map((g) => g.members)).toEqual([[0, 1], [2]]);
    expect(JSON.stringify(cmp)).not.toContain('マーカー');
  });
});

describe('実SDK接続部分のモック検査', () => {
  it('合意分析の入力と出力の対応を検査する', async () => {
    responseBody = { groups: [{ label: '同じ意味', members: [0] }], addressedInsightIds: ['known'] };
    const result = await vertexGemini('p', 'global', 'gemini-3.5-flash').compare(['一文'], [{ id: 'known', summary: '論点' }], ['発言']);
    expect(result).toMatchObject(responseBody);
    expect(calls.at(-1)!.req.config).toMatchObject({ httpOptions: { retryOptions: { attempts: 1 } } });
    responseBody = { groups: [{ label: '不正', members: [9] }], addressedInsightIds: [] };
    expect((await vertexGemini('p', 'global', 'gemini-3.5-flash').compare(['一文'], [], [])).groups).toEqual([{ label: '分類されなかった理解', members: [0] }]);
  });
  it('音声のSDK要求と応答スキーマをモックで確認する', async () => {
    const { mockGemini } = await import('../../src/gemini.js');
    responseBody = await mockGemini().analyzeDiscussion({ audio: Buffer.alloc(1), mimeType: 'audio/wav', durationSec: 60, theme: '架空のテーマ', opinions: [] });
    const result = await vertexGemini('p', 'global', 'gemini-3.5-flash').analyzeDiscussion({ audio: Buffer.alloc(1), mimeType: 'audio/wav', durationSec: 60, theme: '架空のテーマ', opinions: [] });
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

it('AI用の環境変数で受け取った認証をVertex SDKへ直接渡せる', async () => {
  const credentials = { type: 'service_account' as const, project_id: 'p', client_email: 'dummy@example.com', private_key: 'dummy PRIVATE KEY' }; // submit-allow: SDKモックの検証専用
  await vertexGemini('p', 'global', 'gemini-3.5-flash', credentials).findPoints(['架空の意見'], []);
  expect(calls.at(-1)!.init).toMatchObject({ vertexai: true, project: 'p', googleAuthOptions: { credentials } });
});

it('グループの公開メモから議論の軸と提案を構造化し、不明なグループは採用しない', async () => {
  responseBody = { groups: [{ group: 1, focus: '根拠の確かめ方', points: ['情報源の確認'] }, { group: 2, focus: '対象外', points: [] }], suggestions: [{ kind: 'new_angle', summary: '検証後の運用も考える' }] };
  const result = await vertexGemini('p', 'global', 'gemini-3.5-flash').summarizeGroups({ theme: '架空のテーマ', groups: [{ group: 1, messages: ['公開済みの発言メモ'] }] });
  expect(result.groups).toHaveLength(1); expect(result.suggestions[0].kind).toBe('new_angle'); expect(JSON.stringify(calls.at(-1)!.req)).toContain('公開済みの発言メモ'); expect(calls.at(-1)!.req.config.responseSchema).toBeDefined();
});
