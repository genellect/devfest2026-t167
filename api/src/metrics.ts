// 4つの指標の計算。分母が0のときは null を返し、画面では「データなし」と表示する。

/** 意見の反映率 = 事前意見から抽出した論点のうち、議論で取り上げられた割合 */
export function reflectionRate(points: { discussed: boolean }[]): number | null {
  if (points.length === 0) return null;
  return points.filter((p) => p.discussed).length / points.length;
}

/** 認識一致度 = 合意の一文を意味でまとめたとき、最大のまとまりに入った人の割合（回答2人未満は null） */
export function alignmentRate(groups: { members: number[] }[], respondents: number): number | null {
  if (respondents < 2) return null;
  const largest = Math.max(0, ...groups.map((g) => new Set(g.members).size));
  return Math.min(1, largest / respondents);
}

/** 参加の公平性 = 1 − 発言数のジニ係数（参加者2人未満、または発言0件は null） */
export function participationFairness(countsPerParticipant: number[]): number | null {
  const n = countsPerParticipant.length;
  const total = countsPerParticipant.reduce((a, b) => a + b, 0);
  if (n < 2 || total === 0) return null;
  const sorted = [...countsPerParticipant].sort((a, b) => a - b);
  let cum = 0;
  sorted.forEach((x, i) => { cum += (i + 1) * x; });
  const gini = (2 * cum) / (n * total) - (n + 1) / n;
  return 1 - gini;
}

/** 介入の有効率 = 承認した提案のうち、承認後の議論で取り上げられた割合 */
export function interventionEffectiveness(approved: number, addressed: number): number | null {
  if (approved === 0) return null;
  return Math.min(1, addressed / approved);
}

/** 納得度を出すのに必要な回答数。2人では自分の値から相手の値が分かるので、分布と平均を出さない */
export const AGREEMENT_MIN_RESPONDENTS = 3;
/**
 * 納得度（結論の一文と一緒に答える1〜5）の分布と平均。匿名で集めた値なので、回答が少ないと個人が分かる。
 * 3人未満のときは counts・average を null にし、画面では本人の値だけを出す。範囲外の値は数えない。
 */
export function agreementSummary(values: unknown[]): { respondents: number; counts: number[] | null; average: number | null } {
  const valid = values.filter((v): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5);
  if (valid.length < AGREEMENT_MIN_RESPONDENTS) return { respondents: valid.length, counts: null, average: null };
  const counts = [1, 2, 3, 4, 5].map((n) => valid.filter((v) => v === n).length);
  return { respondents: valid.length, counts, average: valid.reduce((a, b) => a + b, 0) / valid.length };
}
