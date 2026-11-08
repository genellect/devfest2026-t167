"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { useGroupRecording } from "@/lib/recording";
import { millis, useMembers, type Room } from "@/lib/room";
import { mmss } from "@/lib/recorder";
import { SessionMaterials } from "./SessionMaterials";
import styles from "./participant-session.module.css";

export function ParticipantWaiting({ roomId, room, uid, group }: { roomId: string; room: Room; uid: string; group?: number }) {
  const router = useRouter();
  const members = useMembers(roomId, true).filter(m => m.role === "participant" && m.status !== "inactive" && m.group === group);
  const people = members.flatMap(m => (m.attendees ?? [{ id: m.id, displayName: m.displayName || "参加者" }]).map(a => ({ ...a, own: m.id === uid })));
  return <section className={styles.waiting} aria-labelledby="participant-waiting-title">
    <span className={styles.waitIcon} aria-hidden="true">⌛</span>
    <h2 id="participant-waiting-title">参加できました</h2>
    <p role="status">教員が議論を始めるまで待っています</p>
    {room.participantView?.theme !== false && <div className={styles.waitTheme}><small>今日のテーマ</small><p>{room.theme || room.title}</p></div>}
    {room.participantView?.members !== false && <div className={styles.members}><h3>グループ{group}</h3><ul>{people.map(p => <li key={p.id}><span className={styles.avatar} aria-hidden="true">{p.displayName.charAt(0)}</span>{p.displayName}{p.own && <small>自分</small>}</li>)}</ul></div>}
    <button className={styles.textButton} onClick={() => router.push("/home")}>ホームへ戻る</button>
  </section>;
}

/** 表示の波形は、録音と話者集計に渡す同じマイクの音量を使う。 */
export function ParticipantSession({ roomId, room, recording, canRecord, speakerStatus, onLeave, children }: {
  roomId: string; room: Room; recording: ReturnType<typeof useGroupRecording>; canRecord: boolean;
  speakerStatus: string; onLeave: () => boolean; children?: ReactNode;
}) {
  const router = useRouter(), settings = useRef<HTMLDialogElement>(null), settingsButton = useRef<HTMLButtonElement>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const elapsed = mmss(Math.max(0, now - (millis(room.startedAt) ?? now)));
  const rec = recording.rec, active = rec.state === "recording", allowed = canRecord && room.recording !== false;
  const [reduced, setReduced] = useState(false);
  useEffect(() => { const media = matchMedia("(prefers-reduced-motion: reduce)"); const update = () => setReduced(media.matches); update(); media.addEventListener("change", update); return () => media.removeEventListener("change", update); }, []);
  const radius = 142;
  return <main className={styles.session} aria-label="話し合い中">
    <button ref={settingsButton} className={styles.settingsButton} aria-label="設定を開く" onClick={() => settings.current?.showModal()}>⚙</button>
    <div className={styles.discussionContent}>
      <h1 className={styles.discussionTitle}>{room.participantView?.theme === false ? room.title : room.theme || room.title}</h1>
      {room.participantView?.timer !== false && <div className={styles.timer} role="timer" aria-label="経過時間"><span aria-hidden="true">◷</span>{elapsed}</div>}
      <div className={styles.waveformArea}>
        <svg className={styles.waveform} viewBox="0 0 400 400" role="img" aria-label="マイク音量の表示" data-active={active}>
          {Array.from({ length: 96 }, (_, i) => { const angle = i * Math.PI * 2 / 96 - Math.PI / 2; const outer = radius + 9 + (active && !reduced ? rec.level * (18 + 36 * (Math.sin(i * .7) + 1) / 2) : 0); return <line key={i} x1={200 + Math.cos(angle) * radius} y1={200 + Math.sin(angle) * radius} x2={200 + Math.cos(angle) * outer} y2={200 + Math.sin(angle) * outer} stroke={i % 9 < 4 ? "#1a73e8" : "#8ab4f8"} strokeWidth="6" strokeLinecap="round" />; })}
        </svg>
        <div className={styles.micControls}>
          {allowed ? <>
            <button className={styles.micButton} aria-label={active ? "録音を停止して端末に保管" : "録音を始める"} disabled={rec.state === "asking" || rec.state === "stopped"} onClick={() => active ? void rec.stop() : void rec.start()}>
              <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" /></svg>
            </button>
            <span className={styles.micLabel}>{active ? "録音中" : rec.state === "asking" ? "マイクの許可を待っています" : rec.state === "stopped" ? "録音は停止済みです" : "タップして録音"}</span>
          </> : <span className={styles.micLabel}>{room.recording === false ? "録音しないセッション" : "別の端末で録音中"}</span>}
        </div>
      </div>
      {(rec.state === "denied" || rec.state === "unsupported") && <div className={styles.error} role="status"><p>{rec.state === "denied" ? "マイクが使えません。ブラウザで許可して、もう一度お試しください。" : "この端末やブラウザでは録音できません。"}</p>{rec.state === "denied" && <button onClick={() => void rec.start()}>もう一度試す</button>}</div>}
      {rec.saveError && <p className={styles.error} role="alert">{rec.saveError}</p>}
    </div>
    <SessionMaterials roomId={roomId} elapsed={elapsed} />
    <dialog ref={settings} className={styles.settings} aria-labelledby="session-settings-heading" onClose={() => settingsButton.current?.focus()}>
      <header><h2 id="session-settings-heading">セッションの設定</h2><button aria-label="設定を閉じる" onClick={() => settings.current?.close()}>×</button></header>
      {active && <button onClick={() => { void rec.stop(); settings.current?.close(); }}>録音を停止して端末に保管</button>}
      {["recording", "paused", "stopped"].includes(rec.state) && <button onClick={() => { void recording.discard(); settings.current?.close(); }}>録音を破棄</button>}
      {speakerStatus && <p role="status">{speakerStatus}</p>}
      {children}
      <button onClick={() => { if (onLeave()) router.push("/home"); }}>ホームへ戻る</button>
    </dialog>
  </main>;
}
