import { expect, it } from "vitest";
import { groupSpeakingBalance } from "./group-balance";
import type { SpeakingState } from "@/components/Speaking";
const group = (g: number, times: number[], unknownMs = 0): SpeakingState => ({ group: g, source: "mock", processedMs: 1000, unknownMs, talkMs: Object.fromEntries(times.map((ms, i) => [String(i), ms])), members: times.map((_, i) => ({ uid: String(i), label: `参加者${i}` })), latest: null });
it("各グループを同じ重みで平均し、録音の長さで偏らない", () => {
  expect(groupSpeakingBalance([group(1, [1, 1]), group(2, [1000, 0])], 2)).toEqual({ value: .75, groups: 2 });
  expect(groupSpeakingBalance([group(1, [1, 1], 999999)], 1).value).toBe(1);
});
it("未集計・1人・不正な時間・範囲外は0%として数えず、対象数を返す", () => {
  expect(groupSpeakingBalance([group(1, [0, 0]), group(2, [1]), group(3, [-1, 2]), group(4, [NaN, 2]), group(9, [1, 1])], 4)).toEqual({ value: null, groups: 0 });
  expect(groupSpeakingBalance([group(1, [1, 1]), group(1, [1, 0]), group(2, [0, 0])], 2)).toEqual({ value: 1, groups: 1 });
});
