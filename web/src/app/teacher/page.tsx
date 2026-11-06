"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loading } from "@/components/ui";
import { signOutHost, useHostUser, useIsTeacher } from "@/lib/hostAuth";
import { sessionRequest } from "@/lib/session";

interface Discussion { sessionId: string; title: string; theme: string; phase: string; ended?: boolean; role: "host" | "participant" }

/**
 * 教員のホーム。学生の画面とURLを分ける（Docs「UIフィードバック」「サーバーフィードバック」）。
 * 招待された教員だけが入れる。主役は「ディスカッションを作る」で、その下に作ったディスカッションを並べる。
 */
export default function TeacherHome() {
  const router = useRouter();
  const user = useHostUser();
  const teacher = useIsTeacher();
  const [sessions, setSessions] = useState<Discussion[]>(), [error, setError] = useState("");
  useEffect(() => {
    if (user === null) router.replace("/");
    else if (teacher === false) router.replace("/join");
  }, [user, teacher, router]);
  useEffect(() => {
    if (!teacher) return;
    let active = true;
    sessionRequest<{ sessions: Discussion[] }>("/discussions")
      .then((r) => { if (active) setSessions(r.sessions.filter((s) => s.role === "host")); })
      .catch(() => { if (active) setError("ディスカッションの一覧を取得できませんでした。接続を確かめて再読み込みしてください。"); });
    return () => { active = false; };
  }, [teacher]);
  if (!user || !teacher) return <Loading />;
  const state = (s: Discussion) => s.ended ? { label: "終了", tone: "done" } : s.phase === "collecting" ? { label: "準備中", tone: "ready" } : { label: "議論中", tone: "live" };
  return (
    <main className="screen teacher">
      <header className="appbar">
        <div className="appbar__title">
          <p className="appbar__who">Discuss<span className="pill pill--ready" style={{ marginLeft: 8 }}>教員</span></p>
          <h1 className="appbar__theme">教員のホーム</h1>
        </div>
        <Link className="btn btn--small" href="/sessions">アカウント</Link>
        <button className="btn btn--small" onClick={async () => { await signOutHost(); window.location.assign("/"); }}>ログアウト</button>
      </header>
      <div className="teacher__body">
        <section className="teacher-create" aria-labelledby="create-title">
          <h2 id="create-title" className="t-md">次の授業のディスカッション</h2>
          <p className="t-note">テーマを決めると、教室に映す参加コードとQRコードを作ります。</p>
          <Link className="btn btn--blue start-btn teacher-create__btn" href="/host/new">ディスカッションを作る</Link>
        </section>
        <section className="flow-card stack" aria-labelledby="mine-title">
          <h2 id="mine-title" className="t-sm">作ったディスカッション</h2>
          {error && <p className="notice notice--error" role="alert">{error}</p>}
          {sessions === undefined && !error && <p className="t-note">読み込んでいます…</p>}
          {sessions?.length === 0 && <p className="t-note">まだありません。作ったディスカッションは、ここから開き直せます。</p>}
          {!!sessions?.length && (
            <ul className="teacher-list">
              {sessions.map((s) => {
                const st = state(s);
                return <li key={s.sessionId}><Link href={`/rooms/${s.sessionId}`} className="teacher-list__item mvp-session-link">
                  <span className="teacher-list__title">{s.theme || s.title}</span>
                  <span className={`pill pill--${st.tone}`}>{st.label}</span>
                </Link></li>;
              })}
            </ul>
          )}
        </section>
        <Link className="text-btn" href="/join">参加者として参加する</Link>
      </div>
    </main>
  );
}
