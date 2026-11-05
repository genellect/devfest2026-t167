"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Header, Loading } from "@/components/ui";
import { canUseTestHost, signInAsHost, signInAsTestHost, signOutHost, useHostUser } from "@/lib/hostAuth";
import { getHistory, getProfile, getRoomLabel, shortDate, type HistoryItem, type Profile } from "@/lib/local";

/** S1 先生のログイン → H1 先生のホーム */
export default function HostHome() {
  const user = useHostUser();
  if (user === undefined) return <Loading />;
  if (user === null) return <HostLogin />;
  return <HostDashboard fallbackName={user.displayName ?? user.email ?? "先生"} />;
}

function HostLogin() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function login(how: () => Promise<void>) {
    setBusy(true); setError("");
    try { await how(); } catch (e) { setError(`ログインできませんでした：${(e as Error).message}`); setBusy(false); }
  }
  return (
    <main className="screen" style={{ display: "grid", gridTemplateColumns: "minmax(0, 11fr) minmax(0, 7fr)" }}>
      <section className="box--blue" style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 64px", gap: 24 }}>
        <h1 className="t-hero" style={{ fontSize: 56, lineHeight: 1.5 }}>話し合いのあとに、<br />次の一歩が見つかる。</h1>
        <p className="t-label" style={{ fontSize: 19 }}>一人ひとりの考えと成長を、授業につなげます。</p>
      </section>
      <section style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 64px", gap: 16 }}>
        <h2 className="t-md">先生としてログイン</h2>
        <p className="t-note">授業の部屋を作るには、ログインが必要です。</p>
        <button className="btn btn--yellow btn--block" onClick={() => login(signInAsHost)} disabled={busy}>{busy ? "ログインしています…" : "Googleでログイン"}</button>
        {canUseTestHost && (
          <button className="btn btn--block" onClick={() => login(signInAsTestHost)} disabled={busy}>テスト用の先生でログイン（エミュレータ）</button>
        )}
        {error && <p className="notice notice--error" role="alert">{error}</p>}
        <p className="t-note">はじめての方は <Link href="/host/signup" style={{ color: "inherit" }}>新規登録</Link></p>
        <Link className="btn btn--small" href="/" style={{ alignSelf: "flex-start" }}>トップに戻る</Link>
      </section>
    </main>
  );
}

function HostDashboard({ fallbackName }: { fallbackName: string }) {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => { setHistory(getHistory("host")); setProfile(getProfile()); }, []);
  const name = profile?.name ?? fallbackName;
  return (
    <main className="screen">
      <Header eyebrow={profile?.school} title={`${name}のホーム`}>
        <Link className="btn btn--small" href="/host/profile">設定</Link>
        <button className="btn btn--small" onClick={() => signOutHost()}>ログアウト</button>
      </Header>
      {!profile && (
        <p className="notice notice--warn" style={{ margin: "20px 32px 0", display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ flex: 1 }}>プロフィールがまだ登録されていません。名前とクラスを登録すると、画面に表示されます。</span>
          <Link className="btn btn--small" href="/host/profile">登録する</Link>
        </p>
      )}
      <div className="body" style={{ display: "grid", gridTemplateColumns: "460px minmax(0, 1fr)", gap: 28 }}>
        <section className="box box--lg box--blue pad-lg stack" style={{ justifyContent: "center", gap: 24 }}>
          <h2 className="t-xl" style={{ lineHeight: 1.5 }}>今日の議論を<br />始める</h2>
          <p className="t-label">テーマを決めて、部屋を作ります。</p>
          <Link className="btn btn--yellow btn--block" href="/host/new">新しい議論を作る</Link>
        </section>
        <section className="box box--lg pad stack">
          <h2 className="t-sm">これまでの議論</h2>
          {history.length === 0 && <p className="empty">作った議論が、この端末にここに並びます。</p>}
          {history.map((h) => (
            <div key={h.roomId} className="box box--bg pad" style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <span className="t-label">{shortDate(h.at)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p className="t-sm">{h.title}</p>
                {getRoomLabel(h.roomId) && <p className="t-small">{getRoomLabel(h.roomId)}</p>}
              </div>
              <Link className="btn btn--small" href={`/rooms/${h.roomId}`}>結果を見る</Link>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
