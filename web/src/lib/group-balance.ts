import type { SpeakingState } from "@/components/Speaking";
/** 各グループの既知の発言時間で1-Giniを求め、グループを同じ重みで平均する。 */
export function groupSpeakingBalance(states: SpeakingState[], totalGroups: number) {
  const values = new Map<number, number>();
  for (const state of states) {
    if (state.group < 1 || state.group > totalGroups || values.has(state.group) || state.members.length < 2) continue;
    const counts = state.members.map(m => state.talkMs[m.uid] ?? 0).sort((a, b) => a - b);
    if (counts.some(n => !Number.isFinite(n) || n < 0)) continue;
    const sum = counts.reduce((a, b) => a + b, 0), n = counts.length;
    if (!sum) continue;
    const weighted = counts.reduce((s, value, i) => s + (i + 1) * value, 0);
    values.set(state.group, Math.max(0, Math.min(1, 1 - ((2 * weighted) / (n * sum) - (n + 1) / n))));
  }
  return { value: values.size ? [...values.values()].reduce((a, b) => a + b, 0) / values.size : null, groups: values.size };
}
