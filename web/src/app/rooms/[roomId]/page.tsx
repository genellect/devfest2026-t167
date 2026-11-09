"use client";
import "./session.css";
import Link from "next/link";
import { use, useEffect } from "react";
import { ErrorScreen, Loading } from "@/components/ui";
import { HostRoom } from "@/components/host/HostRoom";
import { TeacherRoom } from "@/components/host/TeacherRoom";
import { ParticipantRoom } from "@/components/participant/ParticipantRoom";
import { addHistory } from "@/lib/local";
import { useDoc, useUid, type Room } from "@/lib/room";

/** 部屋の画面。司会者（Host）か参加者（参加者）かで、表示する画面を切り替える */
export default function RoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = use(params);
  const uid = useUid();
  const member = useDoc<{ role: "host" | "participant"; group?: number }>(uid ? `sessions/${roomId}/members/${uid}` : undefined);
  const isMember = !!member.data;
  const room = useDoc<Room>(isMember ? `sessions/${roomId}` : undefined);
  const role = member.data?.role;

  useEffect(() => {
    if (room.data && role) addHistory(role === "host" ? "host" : "participant", { roomId, title: room.data.title });
  }, [room.data?.title, role, roomId]); // eslint-disable-line react-hooks/exhaustive-deps

  const back = <Link className="btn btn--blue" href="/join">参加コードを入力する</Link>;
  if (!room.data && (member.error || room.error)) return <ErrorScreen message={member.error ?? room.error ?? ""} action={back} />;
  if (member.data === null) return <ErrorScreen message="この部屋のメンバーではありません。参加コードを入力して参加してください。" action={back} />;
  if (!room.data || !role) return <Loading />;
  const warning = member.error || room.error;
  return <>{warning && <p className="notice notice--warn" role="status">{warning}</p>}{role === "host"
    ? room.data.flowVersion === 1 ? <TeacherRoom roomId={roomId} room={room.data} /> : <HostRoom roomId={roomId} room={room.data} />
    : <ParticipantRoom roomId={roomId} room={room.data} uid={uid!} group={member.data?.group ?? (room.data.groupSelection !== "host" && (room.data.groups ?? 1) <= 1 ? 1 : undefined)} />}</>;
}
