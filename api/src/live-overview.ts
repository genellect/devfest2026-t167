import { z } from 'zod';
const short = (max: number) => z.string().trim().min(1).transform(s => s.slice(0, max));
export const LiveOverviewSchema = z.object({
  groups: z.array(z.object({ group: z.number().int().min(1).max(12), focus: short(80), points: z.array(short(120)).transform(a => [...new Set(a)].slice(0, 3)) })).max(12),
  suggestions: z.array(z.object({ kind: z.enum(['missing', 'new_angle']), summary: short(200) })).transform(a => a.slice(0, 6)),
});
export type LiveOverview = z.infer<typeof LiveOverviewSchema>;
export interface LiveOverviewInput { theme: string; groups: { group: number; messages: string[] }[] }
/** 入力にあるグループだけを返し、不明な番号や重複を採用しない。 */
export function validateLiveOverview(value: unknown, groups: number[]): LiveOverview {
  const parsed = LiveOverviewSchema.parse(value), allowed = new Set(groups), seen = new Set<number>();
  return { groups: parsed.groups.filter(g => allowed.has(g.group) && !seen.has(g.group) && seen.add(g.group)), suggestions: [...new Map(parsed.suggestions.map(s => [s.summary, s])).values()] };
}
