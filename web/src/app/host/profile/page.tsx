"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { TabBar } from "@/components/nav";
import { Header, Loading } from "@/components/ui";
import { ProfileForm } from "@/components/host/ProfileForm";
import { signOutHost, useHostUser } from "@/lib/hostAuth";
import { setRole } from "@/lib/local";

/** 先生の設定：プロフィールの変更とログアウト */
export default function ProfilePage() {
  const router = useRouter();
  const user = useHostUser();
  const [saved, setSaved] = useState(false);
  if (user === undefined) return <Loading />;
  if (user === null) {
    return (
      <main className="screen">
      <Link href="/sessions" className="btn btn--small" style={{ margin: 12 }}>端末とセッション</Link><div className="body body--center">
        <div className="box box--lg card card--narrow"><p className="t-label">設定を変えるには、先生としてログインしてください。</p>
          <Link className="btn btn--yellow" href="/">ログインする</Link></div>
      </div></main>
    );
  }
  return (
    <main className="screen screen--tabs">
      <Header title="設定" nav={<TabBar role="host" />} />
      <div className="body body--center">
        <div className="box box--lg card" style={{ width: "min(720px, 100%)" }}>
          <h2 className="card__title">プロフィール</h2>
          <ProfileForm defaultName={user.displayName ?? ""} submitLabel="保存する" onSaved={() => setSaved(true)} />
          {saved && <p className="notice" role="status">保存しました。</p>}
          <div className="toolbar">
            <p className="t-note toolbar__grow">ログイン中：{user.email ?? user.displayName}</p>
            <button className="btn" onClick={() => { setRole(user.uid, "student"); router.push("/student"); }}>生徒として使う</button>
            <button className="btn" onClick={async () => { await signOutHost(); router.push("/"); }}>ログアウト</button>
          </div>
        </div>
      </div>
    </main>
  );
}
