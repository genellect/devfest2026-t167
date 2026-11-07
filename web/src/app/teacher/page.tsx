"use client";
import Link from "next/link";
import { ChevronRight, MessagesSquare, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loading } from "@/components/ui";
import { AppShell } from "@/components/shell";
import { useHostUser, useIsTeacher } from "@/lib/hostAuth";
import { getRoomLabel } from "@/lib/local";
import { sessionRequest } from "@/lib/session";

interface Discussion { sessionId: string; title: string; theme: string; phase: string; ended?: boolean; role: "host" | "participant"; className?: string }

const state = (s: Discussion) => s.ended ? { label: "終了", tone: "done" } : s.phase === "collecting" ? { label: "準備中", tone: "ready" } : { label: "議論中", tone: "live" };

/**
 * 教員のホーム（Figma「最新」02-T）。学生の画面とURLを分ける（Docs「UIフィードバック」「サーバーフィードバック」）。
 * 招待された教員だけが入れる。主役は「議論を作る」で、その下に作った議論を並べる。
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
      .catch(() => { if (active) setError("一覧を読み込めませんでした。接続を確認して、再読み込みしてください。"); });
    return () => { active = false; };
  }, [teacher]);
  if (!user || !teacher) return <Loading />;
  return (
    <AppShell title="教員のホーム" eyebrow={<span className="pill pill--ready">教員</span>} wide>
      <div className="page">
        <header className="page__head">
          <div className="page__intro">
            <h2 className="page__title">議論</h2>
            <p className="t-note">テーマを決めると、教室に映す参加コードとQRコードを作ります。</p>
          </div>
          <div className="page__actions">
            <Link className="btn" href="/join">参加者として参加する</Link>
            <Link className="btn btn--blue" href="/host/new"><Plus aria-hidden="true" strokeWidth={2} />議論を作る</Link>
          </div>
        </header>
        <section className="panel list-panel" aria-labelledby="mine-title">
          <div className="list-panel__head">
            <h3 id="mine-title" className="t-sm">作った議論</h3>
            {sessions && sessions.length > 0 && <span className="t-small">{sessions.length}件</span>}
          </div>
          {error && <p className="notice notice--error" role="alert">{error}</p>}
          {sessions === undefined && !error && <p className="t-note list-panel__empty">読み込んでいます…</p>}
          {sessions?.length === 0 && (
            <div className="empty-state">
              <MessagesSquare aria-hidden="true" strokeWidth={1.5} />
              <p className="t-sm">まだ議論はありません</p>
              <p className="t-note">「議論を作る」から、次の授業のテーマを決めましょう。</p>
            </div>
          )}
          {sessions && sessions.length > 0 && (
            <ul className="list-panel__rows">
              {sessions.map((s) => {
                const st = state(s), label = s.className || getRoomLabel(s.sessionId);
                return (
                  <li key={s.sessionId}>
                    <Link href={`/rooms/${s.sessionId}`} className="session-row mvp-session-link">
                      <span className="session-row__text">
                        {label && <span className="session-row__class">{label}</span>}
                        <span className="session-row__title">{s.theme || s.title}</span>
                      </span>
                      <span className={`pill pill--${st.tone}`}>{st.label}</span>
                      <ChevronRight className="session-row__chevron" aria-hidden="true" strokeWidth={1.75} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
