"use client";
import { APP_NAME } from "@/lib/brand";
import { ClassroomSelector } from "@/components/classroom/ClassroomSelector";
import { workspaceRequest, workspaceToken } from "@/lib/workspace";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { beginScreenTransition } from "@/components/ScreenEntrance";
import styles from "./host-preparation.module.css";
import { callApi } from "@/lib/api";
import { addHistory, setRoomLabel } from "@/lib/local";

/** ホストの準備画面。入力内容を既存APIへ保存して実セッションを開く。 */
export function HostPreparation() {
  const router = useRouter();
  const home = "/home";
  const screen = useRef<HTMLElement>(null);
  const leaving = useRef(false);
  const stopLeaving = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => stopLeaving.current?.(), []);
  function leaveToHome() {
    if (leaving.current) return;
    leaving.current = true;
    if (beginScreenTransition(() => router.push(home), "down")) return;
    const element = screen.current;
    if (!element || !element.animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      router.push(home); return;
    }
    // スクロール済みでも画面全体が下へ抜ける距離にする。
    const distance = window.innerHeight - element.getBoundingClientRect().top;
    element.style.pointerEvents = "none";
    const animation = element.animate([
      { transform: "translateY(0)" }, { transform: `translateY(${distance}px)` },
    ], { duration: 400, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" });
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true; clearTimeout(timeout); router.push(home);
    };
    const timeout = setTimeout(finish, 480);
    stopLeaving.current = () => { finished = true; clearTimeout(timeout); animation.cancel(); };
    void animation.finished.then(finish, finish);
  }
  const [theme, setTheme] = useState("");
  useLayoutEffect(() => {
    const chosen = new URLSearchParams(window.location.search).get("theme")?.trim().slice(0, 100);
    if (chosen) setTheme(chosen);
  }, []);
  const [classroomCourseId, setClassroomCourseId] = useState("");
  useLayoutEffect(() => { const chosen = new URLSearchParams(window.location.search).get("course"); if (chosen && /^[A-Za-z0-9_-]{1,200}$/.test(chosen)) setClassroomCourseId(chosen); }, []);
  const [sessionName, setSessionName] = useState("無題のセッション");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const submitting = useRef(false);
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!theme.trim() || submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    try {
      const title = sessionName.trim() || "無題のセッション";
      const body = { title, theme: theme.trim(), flowVersion: 1, ...(classroomCourseId ? { classroomCourseId } : {}) };
      const { roomId } = classroomCourseId ? await workspaceRequest<{ roomId: string }>("/rooms", { token: workspaceToken(), body }) : await callApi<{ roomId: string }>("/rooms", body);
      setRoomLabel(roomId, title); addHistory("host", { roomId, title });
      router.push(`/rooms/${roomId}`);
    } catch (e) { setError((e as Error).message); submitting.current = false; setBusy(false); }
  }
  return <main ref={screen} className={styles.root} aria-label="ホストの準備">
    <div className={styles.top}><Link href={home} className={styles.brand} aria-label="ホームへ戻る" onClick={event => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); leaveToHome(); } }}><span aria-hidden="true">‹</span>{APP_NAME}</Link><div className={styles.topActions}><button type="button" className={`${styles.iconButton} ${styles.closeButton}`} aria-label="閉じてホームへ戻る" onClick={leaveToHome}><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button></div></div>
    <form className={styles.content} onSubmit={create}>
      <h1>話し合いの準備</h1>
      <label className={styles.field}><span>セッション名</span><input maxLength={40} value={sessionName} onChange={e => setSessionName(e.target.value)} /></label>
      <label className={styles.field}><span>テーマ</span><input required maxLength={100} value={theme} onChange={e => setTheme(e.target.value)} placeholder="大学生のうちにすべきアルバイトは？" /></label>
      <ClassroomSelector value={classroomCourseId} onChange={setClassroomCourseId} />
      {error && <p role="alert">{error}</p>}
      <button type="submit" className={styles.startButton} disabled={busy || !theme.trim()}>{busy ? "作成しています…" : "セッションを作成"} <span aria-hidden="true">→</span></button>
    </form>
  </main>;
}
