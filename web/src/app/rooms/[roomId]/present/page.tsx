"use client";
import Link from "next/link";
import { use } from "react";
import { ErrorScreen, Loading } from "@/components/ui";
import { PresentView } from "@/components/host/PresentView";
import { useDoc, useUid, type Room } from "@/lib/room";

/** 教室に投影する画面。部屋の司会者（ホスト）だけが開ける。参加者が開いたときは、自分の画面へ案内する */
export default function PresentPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = use(params);
  const uid = useUid();
  const member = useDoc<{ role: "host" | "participant" }>(uid ? `sessions/${roomId}/members/${uid}` : undefined);
  const room = useDoc<Room>(member.data?.role === "host" ? `sessions/${roomId}` : undefined);
  if (member.data === null || (member.data && member.data.role !== "host")) {
    return <ErrorScreen message="投影画面は、この議論を作ったホストだけが開けます。" action={<Link className="btn btn--blue" href={`/rooms/${roomId}`}>自分の画面に戻る</Link>} />;
  }
  if (!room.data && (member.error || room.error)) return <ErrorScreen message={member.error ?? room.error ?? ""} action={<Link className="btn" href="/home">ホームへ</Link>} />;
  if (!room.data) return <Loading />;
  return <PresentView roomId={roomId} room={room.data} />;
}
