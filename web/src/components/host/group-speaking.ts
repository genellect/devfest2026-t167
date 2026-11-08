import type { SpeakingState } from "@/components/Speaking";
const colors = ["#1a73e8", "#e96e80", "#f9ab00", "#34a853", "#9270cf", "#00acc1"];
export function speechShares(state?: SpeakingState) {
  const safe = (n: number | undefined) => Number.isFinite(n) ? Math.max(0, n ?? 0) : 0;
  const rows = (state?.members ?? []).map((member, index) => ({ id: member.uid, label: member.label, ms: safe(state?.talkMs[member.uid]), color: colors[index % colors.length] }));
  const known = new Set(rows.map(r => r.id));
  const unknown = safe(state?.unknownMs) + Object.entries(state?.talkMs ?? {}).reduce((n, [id, ms]) => known.has(id) ? n : n + safe(ms), 0);
  const total = rows.reduce((n, r) => n + r.ms, 0) + unknown;
  return { total, rows: [...rows, { id: "unknown", label: "判別不能", ms: unknown, color: "#b5bcc6" }].map(r => ({ ...r, percent: total ? r.ms / total * 100 : 0 })) };
}
