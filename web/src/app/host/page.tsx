"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { TabBar } from "@/components/nav";
import { Header, Loading } from "@/components/ui";
import { useRouter } from "next/navigation";
import { signOutHost, useHostUser } from "@/lib/hostAuth";
import { getHistory, getProfile, getRoomLabel, shortDate, type HistoryItem, type Profile } from "@/lib/local";

/** H1 先生のホーム。ログインしていなければログイン画面へ */
export default function HostHome() {
  const router = useRouter();
  const user = useHostUser();
  useEffect(() => { if (user === null) router.replace("/"); }, [user, router]);
  if (!user) return <Loading />;
  return <HostDashboard fallbackName={user.displayName ?? user.email ?? "先生"} />;
}

function HostDashboard({ fallbackName }: { fallbackName: string }) {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => { setHistory(getHistory("host")); setProfile(getProfile()); }, []);
  const name = profile?.name ?? fallbackName;
  return (
    <main className="screen screen--tabs">
      <Header eyebrow={profile?.school} title={`${name}のホーム`} nav={<TabBar role="host" />}>
        <button className="btn btn--small" onClick={async () => { await signOutHost(); window.location.assign("/"); }}>ログアウト</button>
      </Header>
      {!profile && (
        <p className="notice notice--warn notice--inset notice--bar">
          <span>プロフィールがまだ登録されていません。名前とクラスを登録すると、画面に表示されます。</span>
          <Link className="btn btn--small" href="/host/profile">登録する</Link>
        </p>
      )}
      <div className="body"><div className="split split--home">
        <section className="box box--lg box--blue pad-lg stack" style={{ justifyContent: "center", gap: 24 }}>
          <h2 className="t-xl" style={{ lineHeight: 1.5 }}>今日の議論を<br />始める</h2>
          <p className="t-label">テーマを決めて、部屋を作ります。</p>
          <Link className="btn btn--yellow btn--block" href="/host/new">新しい議論を作る</Link>
        </section>
        <section className="box box--lg pad stack">
          <h2 className="t-sm">これまでの議論</h2>
          {history.length === 0 && <p className="empty">作った議論が、この端末にここに並びます。</p>}
          {history.map((h) => (
            <div key={h.roomId} className="box box--bg pad list-item">
              <span className="t-label">{shortDate(h.at)}</span>
              <div>
                <p className="t-sm">{h.title}</p>
                {getRoomLabel(h.roomId) && <p className="t-small">{getRoomLabel(h.roomId)}</p>}
              </div>
              <Link className="btn btn--small" href={`/rooms/${h.roomId}`}>結果を見る</Link>
            </div>
          ))}
        </section>
      </div></div>
    </main>
  );
}
