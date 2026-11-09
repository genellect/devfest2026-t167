import type { SpeakingMinute, SpeakingState } from './speaker-routes.js';

/**
 * 参加者に配る発言の集計。本人の名前と時間に加えて、ほかのメンバーが2人以上いるときだけ、ほかのメンバーの時間を、
 * 名前とIDを外して1人ずつの配列で渡す（生徒の結果画面で、ほかのメンバーを名前なしのグレーの線で描くため）。直近の発言者は渡さない。
 * - ほかのメンバーが1人だけのときは渡さない（2人のグループでは、線がそのまま相手の推移になるため）
 * - 並びは議論全体の発言時間の多い順にする（名簿の順にすると、参加者の一覧と結び付けられるため）
 */
export interface SelfSpeakingView {
  scope: 'self'; group: number; source: SpeakingState['source']; processedMs: number;
  members: { uid: string; label: string }[]; talkMs: Record<string, number>; totalMs: number;
  /** 声を登録した参加者の人数（名前は渡さない） */
  memberCount: number;
  timeline: (SpeakingMinute & { totalMs: number; othersMs?: number[] })[];
}

/** ほかのメンバーの時間を渡すのに必要な人数（本人を除く） */
export const MIN_OTHERS_FOR_LINES = 2;

const sum = (m: SpeakingMinute) => Object.values(m.talkMs ?? {}).reduce((a, b) => a + b, 0) + (m.unknownMs ?? 0);
const pick = (talk: Record<string, number> | undefined, own: Set<string>) => Object.fromEntries(Object.entries(talk ?? {}).filter(([id]) => own.has(id)));

/** ownIds は本人の端末の参加者ID（共有端末なら、その端末で登録した全員） */
export function selfSpeakingView(state: Partial<SpeakingState>, ownIds: string[]): SelfSpeakingView {
  // 古い形式や書きかけの文書でも配信を止めない（欠けた項目は0として扱う）
  const own = new Set(ownIds), members = state.members ?? [];
  const total = (id: string) => state.talkMs?.[id] ?? 0;
  // 発言時間の多い順。同じ時間なら ID の順（名簿の順や名前とは結び付かない）
  const others = members.filter((m) => !own.has(m.uid)).map((m) => m.uid).sort((a, b) => total(b) - total(a) || (a < b ? -1 : a > b ? 1 : 0));
  const lines = others.length >= MIN_OTHERS_FOR_LINES;
  const totalMs = Object.values(state.talkMs ?? {}).reduce((a, b) => a + b, 0) + (state.unknownMs ?? 0);
  return {
    scope: 'self', group: state.group ?? 0, source: state.source ?? 'mock', processedMs: state.processedMs ?? 0,
    members: members.filter((m) => own.has(m.uid)),
    talkMs: pick(state.talkMs, own), totalMs, memberCount: members.length,
    timeline: (state.timeline ?? []).map((m) => ({
      talkMs: pick(m.talkMs, own), unknownMs: 0, totalMs: sum(m),
      ...(lines ? { othersMs: others.map((id) => m.talkMs?.[id] ?? 0) } : {}),
    })),
  };
}
