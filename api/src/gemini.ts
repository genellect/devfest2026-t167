import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { z } from 'zod';

export interface Point { summary: string; discussed: boolean }
export interface Comparison { groups: { label: string; members: number[] }[]; addressedInsightIds: string[] }
export interface Gemini {
  readonly source: 'gemini' | 'mock';
  findPoints(opinions: string[], messages: string[]): Promise<Point[]>;
  compare(statements: string[], insights: { id: string; summary: string }[], messagesAfterApproval: string[]): Promise<Comparison>;
}

const PointsSchema = z.object({ points: z.array(z.object({ summary: z.string().min(1).max(200), discussed: z.boolean() })).max(20) });
const CompareSchema = z.object({
  groups: z.array(z.object({ label: z.string().max(200), members: z.array(z.number().int().nonnegative()) })).max(20),
  addressedInsightIds: z.array(z.string()).max(50),
});

const TIMEOUT_MS = 20_000;
function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('gemini_timeout')), TIMEOUT_MS))]);
}

/**
 * 生成の設定。思考レベルは LOW にする。論点の判定と一文のまとめに深い推論は要らず、
 * 思考に使ったトークンも出力として課金されるため（既定の MEDIUM より費用が約半分）。
 * モデルや思考レベルを変えるときは CONTRIBUTING の「Gemini のモデルと費用」の手順で比べてから決める。
 */
export const GENERATION_CONFIG = {
  responseMimeType: 'application/json',
  temperature: 0,
  thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
} as const;

/** Vertex AI 経由の Gemini。API キーは使わず、Cloud Run のサービスアカウントで認証する */
export function vertexGemini(project: string, location: string, model: string): Gemini {
  const ai = new GoogleGenAI({ vertexai: true, project, location });
  async function ask<T>(prompt: string, schema: object, parse: z.ZodType<T>): Promise<T> {
    const res = await withTimeout(ai.models.generateContent({
      model,
      contents: prompt,
      config: { ...GENERATION_CONFIG, responseSchema: schema },
    }));
    return parse.parse(JSON.parse(res.text ?? '{}'));
  }
  return {
    source: 'gemini',
    async findPoints(opinions, messages) {
      const prompt = [
        'あなたはグループディスカッションの記録係です。',
        '「事前意見」から論点を最大10個取り出し、それぞれが「議論の発言」の中で取り上げられたかを判定してください。',
        '個人を特定できる表現は要約に含めないでください。',
        '# 事前意見', ...opinions.map((o, i) => `${i + 1}. ${o}`),
        '# 議論の発言', ...messages.map((m, i) => `${i + 1}. ${m}`),
      ].join('\n');
      const schema = { type: Type.OBJECT, properties: { points: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { summary: { type: Type.STRING }, discussed: { type: Type.BOOLEAN } }, required: ['summary', 'discussed'] } } }, required: ['points'] };
      return (await ask(prompt, schema, PointsSchema)).points;
    },
    async compare(statements, insights, messagesAfter) {
      const prompt = [
        '次の「合意内容の一文」を、意味が同じものどうしでまとめてください。members には一文の番号（0始まり）を入れます。',
        'また「承認済みの提案」のうち、「承認後の発言」で取り上げられたものの id を addressedInsightIds に入れてください。',
        '# 合意内容の一文', ...statements.map((s, i) => `${i}: ${s}`),
        '# 承認済みの提案', ...insights.map((x) => `${x.id}: ${x.summary}`),
        '# 承認後の発言', ...messagesAfter.map((m) => `- ${m}`),
      ].join('\n');
      const schema = { type: Type.OBJECT, properties: { groups: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { label: { type: Type.STRING }, members: { type: Type.ARRAY, items: { type: Type.INTEGER } } }, required: ['label', 'members'] } }, addressedInsightIds: { type: Type.ARRAY, items: { type: Type.STRING } } }, required: ['groups', 'addressedInsightIds'] };
      return ask(prompt, schema, CompareSchema);
    },
  };
}

/** ローカル・CI 用のモック。同じ入力には必ず同じ結果を返す。GEMINI_MOCK_FAIL=1 で失敗させる */
export function mockGemini(opts: { fail?: () => boolean; delayMs?: () => number } = {}): Gemini {
  const maybeFail = async () => {
    const d = opts.delayMs?.() ?? 0;
    if (d > 0) await new Promise((r) => setTimeout(r, d));
    if (opts.fail?.()) throw new Error('gemini_mock_failure');
  };
  const key = (s: string) => s.replace(/\s/g, '').slice(0, 4);
  return {
    source: 'mock',
    async findPoints(opinions, messages) {
      await maybeFail();
      const joined = messages.join('\n');
      return opinions.map((o) => ({ summary: o.slice(0, 60), discussed: joined.includes(key(o)) }));
    },
    async compare(statements, insights, messagesAfter) {
      await maybeFail();
      const groups: { label: string; members: number[] }[] = [];
      statements.forEach((s, i) => {
        const g = groups.find((x) => x.label === s.trim());
        if (g) g.members.push(i); else groups.push({ label: s.trim(), members: [i] });
      });
      const joined = messagesAfter.join('\n');
      return { groups, addressedInsightIds: insights.filter((x) => joined.includes(key(x.summary))).map((x) => x.id) };
    },
  };
}
