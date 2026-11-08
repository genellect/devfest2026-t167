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
        <p className="login__brand">Topos</p>
        <h1 className="t-hero login__title">誰の考えも埋もれない議論を、<br />すべての教室に。</h1>
        <p className="login__lead">議論の前に全員の考えを集め、まだ話されていない論点と、合意のずれを AI が見つけます。</p>
        {/* 製品の見本：教員の画面に出る AI の付箋と、結果に出る理解の分かれ方 */}
        <div className="login__board" aria-hidden="true">
          <p className="login__board-label">議論中、教員の画面に</p>
          <span className="note note--yellow">まだ話されていない論点：端末を持たない人は、どう参加する？</span>
          <p className="login__board-label">議論のあと、結果に</p>
          <div className="login__split">
            <span className="note note--blue">申告すれば使ってよい<small>3人</small></span>
            <span className="note note--pink">教員の許可がいる<small>2人</small></span>
          </div>
        </div>
      </section>
      <section className="login__panel">
        <h2 className="login__heading">ログイン</h2>
        {session.reason && <p className="notice" role="status">{logoutMessage(session.reason, session.policy?.idleDays)}</p>}
        {session.message && <p className="notice notice--error" role="alert">{session.message}</p>}
        <label className="check"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /><span>学校の共用端末で利用する</span></label>
        {shared && <div className="field"><label className="field__label" htmlFor="class-end">授業終了時刻</label><input id="class-end" className="input" aria-label="授業終了時刻" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required /><p className="field__hint">この時刻を過ぎると、この端末から自動でログアウトします。</p></div>}
        <button className="btn btn--blue btn--block" onClick={() => login(signInAsHost)} disabled={busy}>{busy ? "ログインしています…" : "Googleでログイン"}</button>
        {canUseTestHost && (
          <div className="stack stack--tight">
            <button className="btn btn--block btn--small" onClick={() => login(signInAsTestHost)} disabled={busy}>テスト用の先生でログイン（エミュレータ）</button>
            <button className="btn btn--block btn--small" onClick={() => login(signInAsTestStudent)} disabled={busy}>テスト用の生徒でログイン（エミュレータ）</button>
          </div>
        )}
        {error && <p className="notice notice--error" role="alert">{error}</p>}
        <Link href="/about" className="login__link">プライバシー</Link>
      </section>
    </main>
  );
}
