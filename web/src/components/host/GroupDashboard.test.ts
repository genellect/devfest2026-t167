import { describe, expect, it } from "vitest";
import { speechShares } from "./group-speaking";
import type { SpeakingState } from "@/components/Speaking";
import { sessionGroups } from "./session-groups";
import type { Flow, Room } from "@/lib/room";
const base: SpeakingState = { group: 1, source: "model", mode: "anonymous", processedMs: 10000, unknownMs: 2000, members: [{ uid: "a", label: "話者A" }, { uid: "b", label: "話者B" }], talkMs: { a: 5000, b: 3000 }, latest: null };
describe("発言割合の分母", () => {
  it("判別不能を含めて100%とし、処理時間に含まれる無音を分母にしない", () => {
    const r = speechShares({ ...base, processedMs: 30000 });
    expect(r.total).toBe(10000); expect(r.rows.map(v => v.percent)).toEqual([50, 30, 20]);
  });
  it("名簿にない話者の時間は失わず判別不能へ加算する", () => {
    const r = speechShares({ ...base, talkMs: { a: 5000, b: 3000, removed: 1000 } });
    expect(r.total).toBe(11000); expect(r.rows.at(-1)?.ms).toBe(3000);
  });
  it("未取得・ゼロ・不正な値から架空の割合を生成しない", () => {
    expect(speechShares().total).toBe(0);
    const r = speechShares({ ...base, unknownMs: NaN, talkMs: { a: -10, b: Infinity } });
    expect(r.total).toBe(0); expect(r.rows.every(v => v.percent === 0)).toBe(true);
  });
});

describe("セッションの実データ接続", () => {
  const room: Room = { title: "授業", theme: "AI", groups: 2, phase: "discussing", createdBy: "host" };
  it("所属グループの参加者・発言時間・録音分析だけを結合する", () => {
    const flow: Flow & { id: string } = { id: "flow-g2", flowNote: "グループ2の要約", totalMinutes: 1, segments: [], good: [], review: [], source: "gemini" };
    const groups = sessionGroups(room, [
      { id: "one", group: 1, role: "participant", status: "active" },
      { id: "two", group: 2, role: "participant", attendees: [{ id: "a", displayName: "A", voiceRegistered: false }, { id: "b", displayName: "B", voiceRegistered: false }] },
      { id: "left", group: 1, role: "participant", status: "inactive" },
      { id: "host", group: 1, role: "host" },
    ], [base], [flow, { id: "summary" }]);
    expect(groups.map(g => g.count)).toEqual([1, 2]);
    expect(groups[0].speaking).toEqual(base); expect(groups[1].speaking).toBeUndefined();
    expect(groups[0].flow).toBeUndefined(); expect(groups[1].flow).toEqual(flow);
  });
  it("未取得を空のまま表示し、終了後の状態と分析中・失敗を引き継ぐ", () => {
    const groups = sessionGroups({ ...room, phase: "closed", groupState: { 1: { total: 99, recording: { status: "analyzing" } }, 2: { recording: { status: "failed" } } } }, [], [], []);
    expect(groups.map(g => g.count)).toEqual([0, 0]);
    expect(groups.every(g => g.status === "終了" && !g.flow && !g.speaking)).toBe(true);
    expect(groups.map(g => g.analysisStatus)).toEqual(["analyzing", "failed"]);
  });
});
