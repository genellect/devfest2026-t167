"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Header, Loading } from "@/components/ui";
import { TabBar } from "@/components/nav";
import { useHostUser, signOutHost } from "@/lib/hostAuth";
import { sessionRequest } from "@/lib/session";
interface Discussion { sessionId: string; title: string; theme: string; phase: string; ended?: boolean; role: "host" | "participant"; groupId: string | null }
export default function Home() {
  const user = useHostUser();
  const [sessions, setSessions] = useState<Discussion[]>([]), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (user) sessionRequest<{ sessions: Discussion[] }>("/discussions").then((r) => { if (active) setSessions(r.sessions); }).catch(() => { if (active) setError("セッション一覧を取得できませんでした。接続を確認して再読み込みしてください。"); });
    return () => { active = false; };
  }, [user]);
  if (!user) return <Loading />;
  return <main className="screen screen--tabs">
    <Header eyebrow="Google Discuss" title="あなたのホーム" nav={<TabBar role="host" />}>
      <button className="btn btn--small" onClick={async () => { await signOutHost(); window.location.assign("/"); }}>ログアウト</button>
    </Header>
    <div className="body">
      <p>こんにちは、{user.displayName ?? "参加者"}さん。セッションごとにHostまたはParticipantとして利用できます。</p>
      <div className="mvp-actions"><section className="box pad-lg stack"><h2>ディスカッションを始めよう</h2><p>参加するセッションで、ホストまたはゲストを選びます。</p><Link className="btn btn--blue" href="/participate">参加する</Link></section></div>
      <section className="stack"><h2>あなたのセッション</h2>
        {error && <p role="alert">{error}</p>}
        {!sessions.length && !error && <p>作成・参加したセッションがここに表示されます。</p>}
        {sessions.map((s) => <Link key={s.sessionId} href={`/rooms/${s.sessionId}`} className="box pad mvp-session-link"><span><strong>{s.title}</strong><br />{s.theme}</span><span>{s.role === "host" ? "Host" : "Participant"}{s.groupId ? `・グループ${s.groupId}` : ""} · {s.ended || s.phase === "closed" ? "終了" : s.phase === "collecting" ? "準備中" : "進行中"}</span></Link>)}
      </section>
      <p className="t-note">Classroomとの連携は不要です。Googleアカウントで基本機能を利用できます。</p>
    </div>
  </main>;
}
