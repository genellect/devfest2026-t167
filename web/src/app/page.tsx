"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loading } from "@/components/ui";
import { canUseTestHost, signInAsHost, signInAsTestHost, signInAsTestStudent, useHostUser } from "@/lib/hostAuth";
import { LOGOUT_MESSAGES, useAppSession } from "@/lib/session";
import { pendingJoinCode } from "@/lib/join-code";


/**
 * ログイン（入口はここだけ）。Google でログインし、全員共通ホームへ進む。
 * QRやリンクから来た人は、ログインのあとにそのまま参加する。
 */
export default function Login() {
  const router = useRouter();
  const user = useHostUser();
  const session = useAppSession();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shared, setShared] = useState(false), [endsAt, setEndsAt] = useState("");

  useEffect(() => {
    if (!user) return;
    // QRやリンクから来た人は、ログインのあとにそのまま参加する。全員共通ホームへ
    router.replace(pendingJoinCode() ? "/join" : "/home");
  }, [user, router]);

  async function login(how: () => Promise<void>) {
    setBusy(true); setError("");
    try {
      await how();
    } catch (e) { setError(`ログインできませんでした：${(e as Error).message}`); setBusy(false); }
  }

  if (user === undefined || user) return <Loading />;
  const options = { isSharedDevice: shared, classEndsAt: shared && endsAt ? new Date(endsAt).getTime() : null };
  const invalidEnd = shared && (!endsAt || new Date(endsAt).getTime() <= Date.now());
  // Figma「最新」01 ログイン（182:1722）：左に一文、右にログイン。スマホでは1列
  return (
    <main className="login-f">
      <section className="login-f__hero">
        <p className="login-f__brand">Topos</p>
        <h1 className="login-f__title">話し合いのあとに、<br />次の一歩が見つかる。</h1>
        <p className="login-f__lead">一人ひとりの考えと成長を、授業につなげます。</p>
      </section>
      <section className="login-f__panel" aria-labelledby="login-title">
        <h2 id="login-title" className="login-f__heading">ログイン</h2>
        {session.reason && LOGOUT_MESSAGES[session.reason] && <p className="notice" role="status">{LOGOUT_MESSAGES[session.reason]}</p>}
        {session.message && <p className="notice notice--error" role="alert">{session.message}</p>}
        <label className="check"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /><span>学校の共用端末で利用する</span></label>
        {shared && <div className="field">
          <label className="field__label" htmlFor="ends-at">授業終了時刻</label>
          <input id="ends-at" className="input" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          <p className="field__hint">無操作で画面をロックし、この時刻にログアウトします。</p>
        </div>}
        <button className="btn btn--blue btn--block login-f__google" onClick={() => login(() => signInAsHost(options))} disabled={busy || invalidEnd}>
          <svg className="login-f__g" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
            <path fill="#fff" d="M43.6 24.5c0-1.5-.1-2.9-.4-4.3H24v8.1h11a9.4 9.4 0 0 1-4.1 6.2v5.2h6.6c3.9-3.6 6.1-8.8 6.1-15.2Z" />
            <path fill="#fff" d="M24 44c5.5 0 10.1-1.8 13.5-4.9l-6.6-5.2c-1.8 1.2-4.1 1.9-6.9 1.9-5.3 0-9.8-3.6-11.4-8.4H5.8v5.3A20.4 20.4 0 0 0 24 44Z" />
            <path fill="#fff" d="M12.6 27.4a12.3 12.3 0 0 1 0-7.8v-5.3H5.8a20.4 20.4 0 0 0 0 18.4l6.8-5.3Z" />
            <path fill="#fff" d="M24 11.2c3 0 5.7 1 7.8 3l5.9-5.9A19.6 19.6 0 0 0 24 3 20.4 20.4 0 0 0 5.8 14.3l6.8 5.3A12 12 0 0 1 24 11.2Z" />
          </svg>
          {busy ? "ログインしています…" : "Googleでログイン"}
        </button>
        {canUseTestHost && (
          <div className="stack stack--tight login-f__test">
            <button className="btn btn--block btn--small" onClick={() => login(() => signInAsTestHost(options))} disabled={busy}>テスト用の先生でログイン（エミュレータ）</button>
            <button className="btn btn--block btn--small" onClick={() => login(() => signInAsTestStudent(options))} disabled={busy}>テスト用の生徒でログイン（エミュレータ）</button>
          </div>
        )}
        {error && <p className="notice notice--error" role="alert">{error}</p>}
        <Link href="/about" className="login-f__link">プライバシー</Link>
      </section>
    </main>
  );
}
