"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loading } from "@/components/ui";
import { googleLoginError, homePath, signInAsHost, useHostUser, useIsTeacher } from "@/lib/hostAuth";
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

  async function login() {
    setBusy(true); setError("");
    try {
      const classEndsAt = shared ? new Date(end).getTime() : null;
      if (shared && (!classEndsAt || classEndsAt <= Date.now())) { setError("授業終了時刻を指定してください"); setBusy(false); return; }
      await signInAsHost({ isSharedDevice: shared, classEndsAt });
    } catch (e) { setError(googleLoginError(e)); setBusy(false); }
  }

  if (user === undefined || user) return <Loading />;
  return (
    <main className="screen login">
      <section className="login__hero">
        <p className="login__brand">Discuss</p>
        <h1 className="t-hero login__title">話す前に、<br />全員の考えを。</h1>
        <p className="login__lead">声にならなかった意見と、合意のずれを見つけるグループディスカッション。</p>
        {/* 黒板に貼った付箋の絵。1枚だけ黄色＝AIが見つけた「まだ話されていない論点」 */}
        <div className="login__board" aria-hidden="true">
          <span className="note note--paper">申告すれば使ってよい</span>
          <span className="note note--paper">アイデア出しだけなら</span>
          <span className="note note--yellow">まだ話されていない：<br />端末を持たない人は？</span>
          <span className="note note--paper">教員の許可がいる</span>
        </div>
      </section>
      <section className="login__panel">
        <h2 className="login__heading">ログイン</h2>
        {session.reason && <p className="notice" role="status">{logoutMessage(session.reason, session.policy?.idleDays)}</p>}
        {session.message && <p className="notice notice--error" role="alert">{session.message}</p>}
        <label className="check"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /><span>学校の共用端末で利用する</span></label>
        {shared && <div className="field"><label className="field__label" htmlFor="class-end">授業終了時刻</label><input id="class-end" className="input" aria-label="授業終了時刻" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required /><p className="field__hint">この時刻を過ぎると、この端末から自動でログアウトします。</p></div>}
        <button className="btn btn--blue btn--block" onClick={() => void login()} disabled={busy}>{busy ? "ログインしています…" : "Googleでログイン"}</button>
        <p className="t-small">Googleで本人確認します。ログインの維持にCookieとサイトデータを使用します。有効なログインが残っている場合は、自動で再開します。</p>
        {error && <p className="notice notice--error" role="alert">{error}</p>}
        <Link href="/about" className="login__link">プライバシー</Link>
      </section>
    </main>
  );
}
