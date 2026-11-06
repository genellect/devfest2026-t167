"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loading } from "@/components/ui";
import { canUseTestHost, homePath, signInAsHost, signInAsTestHost, signInAsTestStudent, useHostUser, useIsTeacher, type LoginOptions } from "@/lib/hostAuth";
import { logoutMessage, useAppSession } from "@/lib/session";
import { pendingJoinCode } from "@/lib/join-code";


/**
 * ログイン（入口はここだけ）。Google でログインし、教員は教員のホーム、学生は参加コードの入力へ進む。
 * QRやリンクから来た人は、ログインのあとにそのまま参加する。
 */
export default function Login() {
  const router = useRouter();
  const user = useHostUser();
  const teacher = useIsTeacher();
  const session = useAppSession();
  const [shared, setShared] = useState(false);
  const [end, setEnd] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user || teacher === undefined) return;
    // QRやリンクから来た人は、ログインのあとにそのまま参加する。教員は教員のホーム、学生は参加コードの入力へ
    router.replace(pendingJoinCode() ? "/join" : homePath(teacher));
  }, [user, teacher, router]);

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
      <section className="login__hero">
        <p className="login__brand">Discuss</p>
        <h1 className="t-hero login__title">話す前に、全員の考えを。</h1>
        <p className="t-label login__lead">発言されなかった意見と、合意のずれを見つけるグループディスカッション。</p>
      </section>
      <section className="login__panel">
        {session.reason && <p className="notice" role="status">{logoutMessage(session.reason, session.policy?.idleDays)}</p>}
        {session.message && <p className="notice notice--error" role="alert">{session.message}</p>}
        <button className="btn btn--blue btn--block" onClick={() => login(signInAsHost)} disabled={busy}>{busy ? "ログインしています…" : "Googleでログイン"}</button>
        <label className="check"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /><span>学校の共用端末で利用する</span></label>
        {shared && <div className="field"><label className="field__label" htmlFor="class-end">授業終了時刻</label><input id="class-end" className="input" aria-label="授業終了時刻" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required /><p className="field__hint">この時刻を過ぎると、この端末から自動でログアウトします。</p></div>}
        {canUseTestHost && (
          <div className="stack stack--tight">
            <button className="btn btn--block btn--small" onClick={() => login(signInAsTestHost)} disabled={busy}>テスト用の先生でログイン（エミュレータ）</button>
            <button className="btn btn--block btn--small" onClick={() => login(signInAsTestStudent)} disabled={busy}>テスト用の生徒でログイン（エミュレータ）</button>
          </div>
        )}
        {error && <p className="notice notice--error" role="alert">{error}</p>}
        <Link href="/about" className="t-note login__link">使い方とプライバシー</Link>
      </section>
    </main>
  );
}
