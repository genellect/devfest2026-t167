import type { SpeakingMinute, SpeakingState } from './speaker-routes.js';

/**
 * 参加者に配る発言の集計。本人の名前と時間に加えて、ほかのメンバーの時間を、名前とIDを外して1人ずつの配列で渡す
 * （生徒の結果画面で、ほかのメンバーを名前なしのグレーの線で描くため）。直近の発言者は渡さない。
 */
export interface SelfSpeakingView {
  scope: 'self'; group: number; source: SpeakingState['source']; processedMs: number;
  members: { uid: string; label: string }[]; talkMs: Record<string, number>; totalMs: number;
  /** 声を登録した参加者の人数（「均等な場合」の線に使う。名前は渡さない） */
  memberCount: number;
  timeline: (SpeakingMinute & { totalMs: number; othersMs: number[] })[];
}

const sum = (m: SpeakingMinute) => Object.values(m.talkMs ?? {}).reduce((a, b) => a + b, 0) + (m.unknownMs ?? 0);
const pick = (talk: Record<string, number> | undefined, own: Set<string>) => Object.fromEntries(Object.entries(talk ?? {}).filter(([id]) => own.has(id)));

/** ownIds は本人の端末の参加者ID（共有端末なら、その端末で登録した全員） */
export function selfSpeakingView(state: Partial<SpeakingState>, ownIds: string[]): SelfSpeakingView {
  // 古い形式や書きかけの文書でも配信を止めない（欠けた項目は0として扱う）
  const own = new Set(ownIds), members = state.members ?? [];
  // ほかのメンバーの並びは集計の名簿の順（名前とIDは渡さない）
  const others = members.filter((m) => !own.has(m.uid)).map((m) => m.uid);
  const totalMs = Object.values(state.talkMs ?? {}).reduce((a, b) => a + b, 0) + (state.unknownMs ?? 0);
  return {
    scope: 'self', group: state.group ?? 0, source: state.source ?? 'mock', processedMs: state.processedMs ?? 0,
    members: members.filter((m) => own.has(m.uid)),
    talkMs: pick(state.talkMs, own), totalMs, memberCount: members.length,
    timeline: (state.timeline ?? []).map((m) => ({ talkMs: pick(m.talkMs, own), unknownMs: 0, totalMs: sum(m), othersMs: others.map((id) => m.talkMs?.[id] ?? 0) })),
  };
}
