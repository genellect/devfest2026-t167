"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loading } from "@/components/ui";
import { canUseTestHost, signInAsHost, signInAsTestHost, signInAsTestStudent, useHostUser, type LoginOptions } from "@/lib/hostAuth";
import { logoutMessage, useAppSession } from "@/lib/session";


/**
 * ログイン（入口はここだけ）。Google でログインし、共通ホームへ進む。
 * 参加コードの入力は、ログイン後のホームから進む。
 */
export default function Login() {
  const router = useRouter();
  const user = useHostUser();
  const session = useAppSession();
  const [shared, setShared] = useState(false);
  const [end, setEnd] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    router.replace("/home");
  }, [user, router]);

  async function login(how: (options: LoginOptions) => Promise<void>) {
    setBusy(true); setError("");
    try {
      const classEndsAt = shared ? new Date(end).getTime() : null;
      if (shared && (!classEndsAt || classEndsAt <= Date.now())) throw new Error("授業終了時刻を指定してください");
      await how({ isSharedDevice: shared, classEndsAt });
    } catch (e) { setError(`ログインできませんでした：${(e as Error).message}`); setBusy(false); }
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
        {session.reason && <p className="notice" role="status">{logoutMessage(session.reason, session.policy?.idleDays)}</p>}
        {session.message && <p role="alert">{session.message}</p>}
        <label className="t-note"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> 学校の共用端末で利用する</label>
        {shared && <label className="field">授業終了時刻<input aria-label="授業終了時刻" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required /></label>}
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
          <p className="t-note">Googleでログインしてホームを開き、参加コードを入力してください。</p>
          <Link href="/about" className="t-note" style={{ color: "inherit" }}>使い方とプライバシー</Link>
        </div>
      </section>
    </main>
  );
}
