import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { z } from 'zod';

export interface Point { summary: string; discussed: boolean }
export interface Comparison { groups: { label: string; members: number[] }[]; addressedInsightIds: string[] }
/**
 * 音声の議論の分析（チームドキュメント「仕様」の F04）。観測された事実（at：録音の経過時間 mm:ss と、該当する発言の要約）と、
 * AI の解釈（よかった点・見直す点・先生への提案）を分ける。画面の「議論の流れ」（web/src/lib/room.ts の Flow）と同じ形を含む。
 */
export interface Moment { at: string; text: string }
export interface Discussion {
  speechDetected: boolean;
  totalMinutes: number;
  segments: { topic: string; minutes: number; highlight?: boolean }[];
  flowNote: string;
  good: Moment[];
  review: (Moment & { question?: string })[];
  behaviors: { questions: Moment[]; responses: Moment[]; reasoning: Moment[]; collaboration: Moment[] };
  teacherSuggestions: string[];
}
export interface Gemini {
  readonly source: 'gemini' | 'mock';
  findPoints(opinions: string[], messages: string[]): Promise<Point[]>;
  compare(statements: string[], insights: { id: string; summary: string }[], messagesAfterApproval: string[]): Promise<Comparison>;
  analyzeDiscussion(input: { audio: Buffer; mimeType: string; durationSec: number; theme: string }): Promise<Discussion>;
}

const PointsSchema = z.object({ points: z.array(z.object({ summary: z.string().min(1).max(200), discussed: z.boolean() })).max(20) });
const CompareSchema = z.object({
  groups: z.array(z.object({ label: z.string().max(200), members: z.array(z.number().int().nonnegative()) })).max(20),
  addressedInsightIds: z.array(z.string()).max(50),
});

const AT = z.string().regex(/^\d{1,3}:\d{2}$/);
const MomentSchema = z.object({ at: AT, text: z.string().min(1).max(200) });
const DiscussionSchema = z.object({
  speechDetected: z.boolean(),
  totalMinutes: z.number().min(0).max(120),
  segments: z.array(z.object({ topic: z.string().min(1).max(40), minutes: z.number().min(0).max(120), highlight: z.boolean().optional() })).max(12),
  flowNote: z.string().max(300),
  good: z.array(MomentSchema).max(6),
  review: z.array(MomentSchema.extend({ question: z.string().max(200).optional() })).max(6),
  behaviors: z.object({
    questions: z.array(MomentSchema).max(8), responses: z.array(MomentSchema).max(8),
    reasoning: z.array(MomentSchema).max(8), collaboration: z.array(MomentSchema).max(8),
  }),
  teacherSuggestions: z.array(z.string().min(1).max(200)).max(5),
});

const TIMEOUT_MS = 20_000;
/** 音声の分析は長い（30分の録音を聞き取って構造化する）。Cloud Run の既定のタイムアウト 300 秒より短くする */
const AUDIO_TIMEOUT_MS = 180_000;
function withTimeout<T>(p: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('gemini_timeout')), ms))]);
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
  const moment = { type: Type.OBJECT, properties: { at: { type: Type.STRING }, text: { type: Type.STRING } }, required: ['at', 'text'] };
  const moments = { type: Type.ARRAY, items: moment };
  const discussionSchema = {
    type: Type.OBJECT,
    properties: {
      speechDetected: { type: Type.BOOLEAN },
      totalMinutes: { type: Type.NUMBER },
      segments: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { topic: { type: Type.STRING }, minutes: { type: Type.NUMBER }, highlight: { type: Type.BOOLEAN } }, required: ['topic', 'minutes'] } },
      flowNote: { type: Type.STRING },
      good: moments,
      review: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { at: { type: Type.STRING }, text: { type: Type.STRING }, question: { type: Type.STRING } }, required: ['at', 'text'] } },
      behaviors: { type: Type.OBJECT, properties: { questions: moments, responses: moments, reasoning: moments, collaboration: moments }, required: ['questions', 'responses', 'reasoning', 'collaboration'] },
      teacherSuggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
    },
    required: ['speechDetected', 'totalMinutes', 'segments', 'flowNote', 'good', 'review', 'behaviors', 'teacherSuggestions'],
  };
  return {
    source: 'gemini',
    async analyzeDiscussion({ audio, mimeType, durationSec, theme }) {
      const prompt = [
        'あなたは、中学・高校・大学のグループ学習を見守る記録係です。添付の音声は、1つのグループの話し合いを1台の端末で録音したものです。',
        `テーマ：${theme}`,
        `録音の長さ：約${Math.max(1, Math.round(durationSec / 60))}分`,
        '話し合いの流れと、対話の行動（質問・応答・根拠の提示・協働）を分析してください。',
        '# 守ること',
        '- 「観測された事実」と「解釈」を分ける。behaviors・good・review の text は、実際の発言を短く言い換えたもので、at はその発言の録音の経過時間（mm:ss）。',
        '- 根拠となる発言がないことは書かない。推測で補わない。',
        '- 話者を特定しない。名前や「〜さん」などの個人を指す表現を使わず、「ある人が」「グループで」と書く。',
        '- 発言が少ない人がいても、傾聴力や意欲が低いと判断しない。発言から人格や性格を推定しない。',
        '- 改善点（review）は、次の議論で実際に試せる行動として書く。question には、そのとき投げかけるとよかった問いを1つ書く。',
        '- 成績や点数をつけない。',
        '- segments は話題ごとの区切りで、minutes の合計が totalMinutes とおおむね一致する。テーマから離れた区切りは highlight を true にする。',
        '- teacherSuggestions は、先生が次の授業で確かめるとよい点（役割の交代、問いかけ方など）。個人を名指ししない。',
        '- 会話がほとんど聞き取れない場合は speechDetected を false にし、ほかの項目は空にする。',
        '- すべて日本語で書く。',
      ].join('\n');
      const res = await withTimeout(ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType, data: audio.toString('base64') } }] }],
        config: { ...GENERATION_CONFIG, responseSchema: discussionSchema },
      }), AUDIO_TIMEOUT_MS);
      return DiscussionSchema.parse(JSON.parse(res.text ?? '{}'));
    },
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
  const mmss = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  return {
    source: 'mock',
    /** 音声の中身は聞かず、長さだけから決まった見本を返す（同じ長さなら同じ結果） */
    async analyzeDiscussion({ durationSec, theme }) {
      await maybeFail();
      const total = Math.max(1, Math.round(durationSec / 60));
      const at = (r: number) => mmss(Math.floor(durationSec * r));
      const first = Math.max(1, Math.round(total * 0.6));
      return {
        speechDetected: true,
        totalMinutes: total,
        segments: [{ topic: theme.slice(0, 20) || '本題', minutes: first }, { topic: 'まとめ', minutes: total - first }].filter((s) => s.minutes > 0),
        flowNote: 'デモデータです。本物の Gemini では、録音から話題の流れを読み取ります。',
        good: [{ at: at(0.2), text: 'ある人の提案に、理由を尋ねる質問が出た' }],
        review: [{ at: at(0.7), text: '結論の前に、まだ話していない意見がないか確かめるとよかった', question: 'ほかの考えの人はいますか？' }],
        behaviors: {
          questions: [{ at: at(0.2), text: '提案の理由を尋ねた' }],
          responses: [{ at: at(0.3), text: '質問に具体例で答えた' }],
          reasoning: [{ at: at(0.4), text: '経験を根拠に意見を述べた' }],
          collaboration: [{ at: at(0.8), text: '出た意見を2つに整理した' }],
        },
        teacherSuggestions: ['次回は記録係と進行役を交代し、まとめる役を別の人が経験できるようにする'],
      };
    },
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
