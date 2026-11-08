import type { SpeakingState } from "@/components/Speaking";
import type { Flow, Member, Room } from "@/lib/room";
import type { GroupView } from "./GroupDashboard";

/** 認可済み配信の同じグループだけを結合する。未取得を架空の値で補わない。 */
export function sessionGroups(room: Room, members: Member[], speaking: SpeakingState[], results: ({ id: string } & Partial<Flow>)[]): GroupView[] {
  return Array.from({ length: room.groups ?? 1 }, (_, i) => {
    const id = i + 1, state = room.groupState?.[String(id)];
    const result = results.find(r => r.id === `flow-g${id}`);
    return {
      id,
      count: members.filter(m => m.role === "participant" && m.status !== "inactive" && m.group === id).reduce((n, m) => n + (m.attendees?.length || 1), 0),
      status: room.endedAt || room.phase === "closed" ? "終了" : room.phase === "collecting" ? "準備中" : state?.status === "done" ? "終了" : state?.status === "consensus" ? "結論を記入中" : "議論中",
      speaking: speaking.find(s => s.group === id),
      flow: result as Flow | undefined,
      analysisStatus: state?.recording?.status,
    };
  });
}
