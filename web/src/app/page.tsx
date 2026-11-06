"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loading } from "@/components/ui";
import { canUseTestHost, signInAsHost, signInAsTestHost, signInAsTestStudent, useHostUser } from "@/lib/hostAuth";
import { getRole, homeOf } from "@/lib/local";

/**
 * ログイン（入口はここだけ）。Google でログインし、初めての人は役割（生徒・先生）を選ぶ画面へ進む。
 * 参加コードだけで議論に入る道も残す（スマホで30秒以内に参加するため）。
 */
export default function Login() {
  const router = useRouter();
  const user = useHostUser();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    const role = getRole(user.uid);
    router.replace(role ? homeOf(role) : "/signup");
  }, [user, router]);

  async function login(how: () => Promise<void>) {
    setBusy(true); setError("");
    try { await how(); } catch (e) { setError(`ログインできませんでした：${(e as Error).message}`); setBusy(false); }
  }

  if (user === undefined || user) return <Loading />;
  return (
    <main className="screen login">
      <section className="box--blue login__hero">
        <h1 className="t-hero login__title">話し合いのあとに、<br />次の一歩が見つかる。</h1>
        <p className="t-label login__lead">一人ひとりの考えと成長を、授業につなげます。</p>
      </section>
      <section className="login__panel">
        <h2 className="t-md">ログイン</h2>
        <p className="t-note">はじめての方も、ここからはじめられます。</p>
        <button className="btn btn--yellow btn--block" onClick={() => login(signInAsHost)} disabled={busy}>{busy ? "ログインしています…" : "Googleでログイン"}</button>
        {canUseTestHost && (
          <div className="stack stack--tight">
            <button className="btn btn--block btn--small" onClick={() => login(signInAsTestHost)} disabled={busy}>テスト用の先生でログイン（エミュレータ）</button>
            <button className="btn btn--block btn--small" onClick={() => login(signInAsTestStudent)} disabled={busy}>テスト用の生徒でログイン（エミュレータ）</button>
          </div>
        )}
        {error && <p className="notice notice--error" role="alert">{error}</p>}
        <div style={{ borderTop: "3px solid #000", paddingTop: 16, marginTop: 8 }} className="stack stack--tight">
          <p className="t-note">先生から参加コードを聞いた生徒は、Googleログイン後に参加できます。</p>
          <Link href="/join" className="btn btn--blue btn--block">参加コードを入力する</Link>
          <Link href="/about" className="t-note" style={{ color: "inherit" }}>使い方とプライバシー</Link>
        </div>
      </section>
    </main>
  );
}
