/**
 * 起動時の環境変数を読み、足りない値があればまとめて伝えて止まる。
 * 空文字も未設定として扱う。既定のリージョンやモデルは置かない（黙って別の接続先を使わないため）。
 * 値の出どころ：本番は .github/workflows/deploy.yml（GitHub の Variables）、手元は scripts/dev.sh serve（infra/env.sh）。
 */
export type GeminiConfig =
  | { mock: true; fail: boolean }
  | { mock: false; project: string; location: string; model: string };

export interface Config {
  /** Firestore と Auth のプロジェクト。手元ではエミュレータの demo-t167 */
  project: string;
  gemini: GeminiConfig;
}

type Env = Record<string, string | undefined>;

const PLACEHOLDER = /ここに/;

function value(env: Env, name: string): string | undefined {
  const v = env[name]?.trim();
  return v && !PLACEHOLDER.test(v) ? v : undefined;
}

export function readConfig(env: Env): Config {
  const missing: string[] = [];
  const need = (name: string) => {
    const v = value(env, name);
    if (!v) missing.push(name);
    return v ?? '';
  };

  const project = need('GOOGLE_CLOUD_PROJECT');
  let gemini: GeminiConfig;
  if (value(env, 'GEMINI_MOCK') === '1') {
    gemini = { mock: true, fail: value(env, 'GEMINI_MOCK_FAIL') === '1' };
  } else {
    // Vertex AI のプロジェクトは Firestore と別にできる。手元ではエミュレータ（demo-t167）のまま本物の Gemini を呼ぶため
    const location = need('VERTEX_LOCATION');
    const model = need('GEMINI_MODEL');
    gemini = { mock: false, project: value(env, 'VERTEX_PROJECT') ?? project, location, model };
  }
  if (missing.length > 0) {
    throw new Error(
      `起動に必要な環境変数がありません: ${missing.join('・')}。` +
        '本番は GitHub の Variables（infra/setup-deployer.sh の表示）、手元は infra/env.sh を確かめてください',
    );
  }
  return { project, gemini };
}

/** 起動ログ用。どの接続先で動いているかを Cloud Run のログで確かめられるようにする */
export function describeGemini(g: GeminiConfig): string {
  return g.mock ? `mock${g.fail ? '（失敗させる）' : ''}` : `${g.model} @ ${g.location}（${g.project}）`;
}
