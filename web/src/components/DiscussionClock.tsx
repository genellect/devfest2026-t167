"use client";
import { useEffect, useState } from "react";
import { millis, type Room } from "@/lib/room";

/**
 * 議論の時間。時間の上限がある部屋は残り時間、ない部屋は議論の開始からの経過時間を、つねに出す（教員の設定で隠さない）。
 * 先生のダッシュボードと生徒の画面で、同じ数え方にする。
 */
export function useDiscussionClock(room: Pick<Room, "startedAt" | "endsAt">) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const start = millis(room.startedAt), end = millis(room.endsAt);
  if (end) return { label: "残り時間", seconds: Math.ceil(Math.max(0, end - now) / 1000) };
  if (start) return { label: "経過時間", seconds: Math.floor(Math.max(0, now - start) / 1000) };
  return null;
}

export const formatClock = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
const spoken = (seconds: number) => `${Math.floor(seconds / 60)}分${seconds % 60}秒`;

/** 録音のカードの丸（Figma「最新」P3 録音中・他の人が録音中）。line は録音しない部屋で、見出しの下に1行で出すとき */
export function DiscussionClock({ room, variant = "circle" }: { room: Pick<Room, "startedAt" | "endsAt">; variant?: "circle" | "line" }) {
  const clock = useDiscussionClock(room);
  if (!clock) return null;
  if (variant === "line") return <p className="talk-hero__timer" role="timer" aria-label={`${clock.label} ${spoken(clock.seconds)}`}>{clock.label} {formatClock(clock.seconds)}</p>;
  return (
    <div className="elapsed-circle" role="timer" aria-label={`議論の${clock.label} ${spoken(clock.seconds)}`}>
      <span className="elapsed-circle__label">{clock.label}</span>
      <span className="elapsed-circle__time">{formatClock(clock.seconds)}</span>
    </div>
  );
}
