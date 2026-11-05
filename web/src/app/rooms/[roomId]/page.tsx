"use client";
import Link from "next/link";
import { use, useEffect } from "react";
import { ErrorScreen, Loading } from "@/components/ui";
import { HostRoom } from "@/components/host/HostRoom";
import { ParticipantRoom } from "@/components/participant/ParticipantRoom";
import { addHistory } from "@/lib/local";
import { useDoc, useUid, type Room } from "@/lib/room";

/** 部屋の画面。司会者（先生）か参加者（生徒）かで、表示する画面を切り替える */
export default function RoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = use(params);
  const uid = useUid();
  const member = useDoc<{ role: "moderator" | "participant"; group?: number }>(uid ? `rooms/${roomId}/members/${uid}` : undefined);
  const isMember = !!member.data;
  const room = useDoc<Room>(isMember ? `rooms/${roomId}` : undefined);
  const role = member.data?.role;

  useEffect(() => {
    if (room.data && role) addHistory(role === "moderator" ? "host" : "participant", { roomId, title: room.data.title });
  }, [room.data?.title, role, roomId]); // eslint-disable-line react-hooks/exhaustive-deps

  const back = <Link className="btn btn--blue" href="/join">参加コードを入力する</Link>;
  if (member.error || room.error) return <ErrorScreen message={member.error ?? room.error ?? ""} action={back} />;
  if (member.data === null) return <ErrorScreen message="この部屋のメンバーではありません。参加コードを入力して参加してください。" action={back} />;
  if (!room.data || !role) return <Loading />;
  return role === "moderator"
    ? <HostRoom roomId={roomId} room={room.data} />
    : <ParticipantRoom roomId={roomId} room={room.data} uid={uid!} group={member.data?.group ?? 1} />;
}
