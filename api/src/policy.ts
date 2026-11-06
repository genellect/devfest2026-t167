/** 保存形式に依存しない進行規則。Rules 側にも対応する許可条件と境界テストを持つ。 */
export const PHASES = ['collecting', 'discussing', 'consensus', 'closed'] as const;
export const ANALYZE_COOLDOWN_MS = 30_000;
export const RUNNING_TIMEOUT_MS = 60_000;
export const MAX_GROUPS = 12;
export const MAX_RECORDING_SEC = 31 * 60;
export const MAX_RECORDING_BYTES = 12 * 1024 * 1024;
export const MAX_RECORDING_ATTEMPTS = 3;
export const RECORDING_TIMEOUT_MS = 5 * 60_000;
export const AUDIO_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/aac', 'video/webm', 'video/mp4'];
export const ANALYSIS_PHASES = { analysis: ['collecting', 'discussing'], consensusAnalysis: ['consensus'] };
export function groupNumber(member: { get(field: string): unknown }, groups: number | undefined): number | undefined {
  const value = member.get('group');
  const group = value ?? ((groups ?? 1) <= 1 ? 1 : undefined);
  return typeof group === 'number' && Number.isInteger(group) && group >= 1 && group <= (groups ?? 1) ? group : undefined;
}
export const statusOf = (room: { get(field: string): any }, group: number): string => room.get('groupState')?.[group]?.status ?? 'opinions';
export function groupReady(total: number, submitted: number): boolean { return total > 0 && submitted >= total; }
export function nextGroupState(status: string, total: number, opinions: number, force = false): string {
  return status === 'opinions' && total > 0 && (force || groupReady(total, opinions)) ? 'discussing' : status;
}
export function canSubmitStatement(phase: string, status: string): boolean {
  return phase !== 'closed' && status !== 'done' && (phase === 'consensus' || status === 'consensus');
}
export function messageCounts(uids: string[], authors: string[]): number[] {
  const counts = new Map<string, number>();
  for (const uid of authors) counts.set(uid, (counts.get(uid) ?? 0) + 1);
  return uids.map((uid) => counts.get(uid) ?? 0);
}

export function statementLocked(room: { get(field: string): any }, group: number): boolean {
  return room.get('groupState')?.[group]?.analysis?.running === true || ['running', 'done'].includes(room.get('consensusAnalysis')?.status);
}
