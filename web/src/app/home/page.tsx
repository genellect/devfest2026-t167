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
    <Header eyebrow="Discuss" title="あなたのホーム" nav={<TabBar role="host" />}>
      <button className="btn btn--small" onClick={async () => { await signOutHost(); window.location.assign("/"); }}>ログアウト</button>
    </Header>
    <div className="flow">
      <div className="mvp-actions"><Link className="btn btn--blue btn--block home-join" href="/join">参加する</Link></div>
      <p className="t-note">教員の画面に表示された6桁の数字か、QRコードで参加します。</p>
      <section className="flow-quiet" aria-labelledby="mine">
        <h2 id="mine" className="t-sm">参加したディスカッション</h2>
        {error && <p className="notice notice--error" role="alert">{error}</p>}
        {!sessions.length && !error && <p className="t-note">まだありません。</p>}
        {sessions.map((s) => <Link key={s.sessionId} href={`/rooms/${s.sessionId}`} className="flow-card mvp-session-link"><span><strong>{s.title}</strong>{s.theme && s.theme !== s.title && <><br /><span className="t-note">{s.theme}</span></>}</span><span className="t-note">{s.role === "host" ? "教員" : "参加者"}{s.ended ? "・終了" : ""}</span></Link>)}
      </section>
      <Link className="text-btn" href="/host/new">ディスカッションを作る（教員）</Link>
    </div>
  </main>;
}
