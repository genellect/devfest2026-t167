"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loading } from "@/components/ui";
import { AppShell } from "@/components/shell";
import { ProfileForm } from "@/components/host/ProfileForm";
import { signOutHost, useHostUser } from "@/lib/hostAuth";


/** Hostの設定：プロフィールの変更とログアウト */
export default function ProfilePage() {
  const router = useRouter();
  const user = useHostUser();
  const [saved, setSaved] = useState(false);
  if (user === undefined) return <Loading />;
  if (user === null) {
    return (
      <main className="screen">
      <Link href="/sessions" className="btn btn--small" style={{ margin: 12 }}>端末とセッション</Link><div className="body body--center">
        <div className="box box--lg card card--narrow"><p className="t-label">設定を変えるには、Hostとしてログインしてください。</p>
          <Link className="btn btn--yellow" href="/">ログインする</Link></div>
      </div></main>
    );
  }
  return (
    <AppShell title="設定">
      <div className="flow">
        <section className="flow-card" aria-labelledby="profile-title">
          <h2 id="profile-title" className="flow-card__title">プロフィール</h2>
          <ProfileForm defaultName={user.displayName ?? ""} submitLabel="保存する" onSaved={() => setSaved(true)} />
          {saved && <p className="notice" role="status">保存しました。</p>}
        </section>
        <section className="flow-card" aria-labelledby="account-title">
          <h2 id="account-title" className="flow-card__title">アカウント</h2>
          <p className="t-note">ログイン中：{user.email ?? user.displayName}</p>
          <div className="home-actions">
            <Link className="btn" href="/sessions">端末とセッション</Link>
            <Link className="btn" href="/about">プライバシー</Link>
            <button className="btn" onClick={async () => { await signOutHost(); router.push("/"); }}>ログアウト</button>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
