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

const { GENERATION_CONFIG, vertexGemini } = await import('../../src/gemini.js');

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
