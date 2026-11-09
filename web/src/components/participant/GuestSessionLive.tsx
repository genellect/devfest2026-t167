"use client";
import { Settings } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SessionShell } from "@/components/SessionShell";
import { SessionMaterials } from "@/components/SessionMaterials";
import { millis, useCountdown, type Room } from "@/lib/room";
import { mmss } from "@/lib/recorder";

/** 議論に集中する画面。録音操作やメモは設定を開いたときだけ表示する。 */
export function GuestSessionLive({ roomId, room, level, recording, status, questions, children }: {
  roomId: string; room: Room; level: number; recording: boolean; status: string; questions: number; children: ReactNode;
}) {
  const settings = useRef<HTMLDialogElement>(null);
  const [now, setNow] = useState(() => Date.now());
  const clock = useCountdown(millis(room.startedAt), room.minutes ?? 15);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const elapsed = Math.max(0, now - (millis(room.startedAt) ?? now));
  return <SessionShell title={room.participantView?.theme === false ? room.title : room.theme || room.title} back="/home" hero hideBack actions={
    <button className="guest-session-settings" aria-label="設定" title={questions ? `設定・ホストからの問いかけ${questions}件` : "設定"} aria-haspopup="dialog" onClick={() => settings.current?.showModal()}>
      <Settings size={25} strokeWidth={1.7} aria-hidden="true" />{questions > 0 && <span className="guest-session-settings__badge" aria-hidden="true">{questions}</span>}
    </button>
  }>
    <div className="guest-session-live">
      <section className="guest-session-theme"><h1>{room.participantView?.theme === false ? room.title : room.theme || room.title}</h1></section>
      <section className="guest-session-visual" aria-label="セッション中">
        <h2 className="sr-only">グループで話し合いましょう</h2>
        {room.participantView?.timer !== false && <div className="guest-session-clock"><span>{room.endsAt ? "残り時間" : "経過時間"}</span><strong role="timer" aria-label={room.endsAt ? "残り時間" : "経過時間"}>{room.endsAt ? clock.text : mmss(elapsed)}</strong></div>}
        <div className="guest-session-sound" data-recording={recording || undefined}>
          <svg viewBox="0 0 360 180" role="img" aria-label={recording ? "録音中の音声の波形" : "音声の波形・待機中"}>
            {Array.from({ length: 41 }, (_, i) => {
              const envelope = Math.sin((i + 1) / 42 * Math.PI);
              const height = 5 + (recording ? Math.min(1, Math.max(0, level)) * 145 * envelope * (.4 + .6 * Math.abs(Math.sin(i * 1.9))) : 0);
              return <rect key={i} x={18 + i * 8} y={90 - height / 2} width="4" height={height} rx="2" />;
            })}
          </svg>
        </div>
        <p className="guest-session-sound__status" role="status"><span data-recording={recording || undefined} aria-hidden="true" />{status}</p>
      </section>
      <SessionMaterials roomId={roomId} showEmpty />
    </div>
    <dialog ref={settings} className="dialog guest-session-dialog" aria-labelledby="guest-settings-title" onClick={e => { if (e.target === settings.current) settings.current?.close(); }}>
      <div className="dialog__head"><h2 id="guest-settings-title" className="t-md">セッション設定</h2><button className="btn btn--small" onClick={() => settings.current?.close()}>閉じる</button></div>
      <div className="guest-session-dialog__body">{children}</div>
    </dialog>
  </SessionShell>;
}
