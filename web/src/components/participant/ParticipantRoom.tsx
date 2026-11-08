"use client";
import { GuidedGuest } from "./GuidedGuest";
import { useGroupRecording } from "@/lib/recording";
import { recordingPhase } from "@/lib/recording-phase";
import { groupStatus, millis, useDoc, type GroupResult, type Room } from "@/lib/room";

interface Props { roomId: string; room: Room; uid: string; group?: number }

export function ParticipantRoom({ roomId, room, uid, group }: Props) {
  const status = group ? groupStatus(room, group) : "opinions";
  const gs = group ? room.groupState?.[String(group)] : undefined;
  // グループの結果。全員の一文がそろうと API が書く
  const result = useDoc<GroupResult>(group ? `sessions/${roomId}/results/group-${group}` : undefined).data;
  const closed = room.phase === "closed";
  const showResult = !!result || closed || status === "done";
  const discussing = recordingPhase(room, group, status, showResult);
  // 録音は議論の画面を閉じても残し、議論が終わったら送る
  const groupConfig = useDoc<{ recorderUid?: string | null; name?: string; recordingMode?: "single" | "personal" }>(group ? `sessions/${roomId}/groups/${group}` : undefined).data;
  const canRecord = groupConfig !== undefined && (groupConfig?.recordingMode === "personal" || !groupConfig?.recorderUid || groupConfig.recorderUid === uid);
  const own = useDoc<{ recordingStatus?: "analyzing" | "done" | "failed" }>(`sessions/${roomId}/members/${uid}`).data;
  const recordingStatus = groupConfig?.recordingMode === "personal" ? own?.recordingStatus : gs?.recording?.status;
  const recording = useGroupRecording(roomId, discussing && canRecord, recordingStatus, millis(room.endedAt) ?? undefined);
  return <GuidedGuest roomId={roomId} room={room} uid={uid} group={group} recording={recording} canRecord={canRecord} />;
}
