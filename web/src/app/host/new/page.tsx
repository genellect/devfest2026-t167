"use client";
import { ClassroomSelector } from "@/components/classroom/ClassroomSelector";
import { workspaceRequest, workspaceToken } from "@/lib/workspace";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loading } from "@/components/ui";
import { AppShell } from "@/components/shell";
import { callApi } from "@/lib/api";
import { useHostUser } from "@/lib/hostAuth";
import { addHistory } from "@/lib/local";
import styles from "@/components/mobile/action-form.module.css";


/** 議論を作る。Hostはセッションごとに決める。 */
export default function NewRoom() {
  const router = useRouter();
  const user = useHostUser();
  const [title, setTitle] = useState("無題のセッション");
  const [course, setCourse] = useState("");
  const [theme, setTheme] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const suggested = new URLSearchParams(window.location.search).get("theme");
    if (suggested) setTheme(suggested.slice(0, 1000));
    setCourse(new URLSearchParams(window.location.search).get("course") ?? "");
  }, []);

  // セッション名とテーマは別々に保存する。グループ・時間・録音は既定値を使う。
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const sessionName = title.trim();
      const body = { title: sessionName, theme: theme.trim(), flowVersion: 1 };
      const { roomId } = course
        ? await workspaceRequest<{ roomId: string }>("/rooms", { token: workspaceToken(), body: { ...body, classroomCourseId: course } })
        : await callApi<{ roomId: string }>("/rooms", body);
      addHistory("host", { roomId, title: sessionName });
      router.push(`/rooms/${roomId}`);
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }

  if (user === undefined) return <Loading />;
  if (user === null) {
    return (
      <main className="screen"><div className="body body--center">
        <div className="box box--lg card card--narrow"><p className="t-label">議論を作るには、Googleでログインしてください。</p>
          <Link className="btn btn--yellow" href="/">ログインする</Link></div>
      </div></main>
    );
  }
  return (
    <AppShell back="/home" title="ホストする" className={styles.shell} account={false} showDemo={false} wide>
      <form className={styles.form} onSubmit={create} aria-labelledby="new-title">
        <h2 id="new-title" className={styles.title}>ホストする</h2>
        <div className="field">
          <label className="field__label" htmlFor="session-name">セッション名</label>
          <input id="session-name" className="input" value={title} maxLength={100} required onChange={event => setTitle(event.target.value)} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="theme">テーマ</label>
          <textarea id="theme" className="input" value={theme} maxLength={1000} required rows={2} onChange={event => setTheme(event.target.value)} />
        </div>
        <ClassroomSelector value={course} onChange={setCourse} />
        {error && <p className="notice notice--error" role="alert">{error}</p>}
        <button className="btn btn--blue" type="submit" disabled={busy || !title.trim() || !theme.trim()}>{busy ? "作成しています…" : "作成する"}</button>
      </form>
    </AppShell>
  );
}
