"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loading } from "@/components/ui";
import { canUseTestHost, signInAsHost, signInAsTestHost, signInAsTestStudent, useHostUser } from "@/lib/hostAuth";
import { LOGOUT_MESSAGES, useAppSession } from "@/lib/session";
import { pendingJoinCode } from "@/lib/join-code";
import styles from "./sign-in-mobile.module.css";


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
  return (
    <main className={`screen login ${styles.mobile}`}>
      <section className="login__hero">
        <p className="login__brand">Topos</p>
        <h1 className={styles.mobileTitle}>Topos</h1>
        <h1 className="t-hero login__title"><span>誰の考えも</span><span>埋もれない議論を、</span><br /><span>すべての教室に。</span></h1>
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
        <h2 className="login__heading"><span className={styles.wideLabel}>ログイン</span><span className={styles.phoneLabel}>サインイン</span></h2>
        {session.reason && LOGOUT_MESSAGES[session.reason] && <p className="notice" role="status">{LOGOUT_MESSAGES[session.reason]}</p>}
        {session.message && <p className="notice notice--error" role="alert">{session.message}</p>}
        <button className={`btn btn--blue btn--block ${styles.googleButton}`} onClick={() => login(signInAsHost)} disabled={busy}>
          <svg className={styles.googleIcon} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
            <path fill="#4285f4" d="M43.6 24.5c0-1.5-.1-2.9-.4-4.3H24v8.1h11a9.4 9.4 0 0 1-4.1 6.2v5.2h6.6c3.9-3.6 6.1-8.8 6.1-15.2Z" />
            <path fill="#34a853" d="M24 44c5.5 0 10.1-1.8 13.5-4.9l-6.6-5.2c-1.8 1.2-4.1 1.9-6.9 1.9-5.3 0-9.8-3.6-11.4-8.4H5.8v5.3A20.4 20.4 0 0 0 24 44Z" />
            <path fill="#fbbc05" d="M12.6 27.4a12.3 12.3 0 0 1 0-7.8v-5.3H5.8a20.4 20.4 0 0 0 0 18.4l6.8-5.3Z" />
            <path fill="#ea4335" d="M24 11.2c3 0 5.7 1 7.8 3l5.9-5.9A19.6 19.6 0 0 0 24 3 20.4 20.4 0 0 0 5.8 14.3l6.8 5.3A12 12 0 0 1 24 11.2Z" />
          </svg>
          {busy ? "ログインしています…" : "Googleでログイン"}
        </button>
        {canUseTestHost && (
          <div className={`stack stack--tight ${styles.testAccounts}`}>
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
