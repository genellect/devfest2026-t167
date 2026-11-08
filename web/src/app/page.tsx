"use client";
import { APP_NAME } from "@/lib/brand";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loading } from "@/components/ui";
import { googleLoginError, signInAsHost, useHostUser } from "@/lib/hostAuth";
import { LOGOUT_MESSAGES, logoutMessage, useAppSession } from "@/lib/session";
import { pendingJoinCode } from "@/lib/join-code";
import styles from "./login.module.css";


/**
 * ログイン（入口はここだけ）。Google でログインし、全員が共通ホームへ進む。
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
    // QRやリンクから来た人は、ログインのあとにそのまま参加する。全員が共通ホームへ
    const code = pendingJoinCode();
    router.replace(`/home${code ? `?code=${encodeURIComponent(code)}` : ""}`);
  }, [user, router]);

  async function login() {
    setBusy(true); setError("");
    try {
      await signInAsHost();
    } catch (e) { setError(googleLoginError(e)); setBusy(false); }
  }

  if (user === undefined || user) return <Loading />;
  return (
    <main className={styles.screen}>
      <div className={styles.card}>
      <section className={styles.panel} aria-labelledby="login-title">
        <div className={styles.brand}>
          <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 4h22a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H15l-8 5v-5H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z" fill="currentColor"/><path d="M10 11h12M10 17h8" stroke="white" strokeWidth="2.5" strokeLinecap="round"/></svg>
          <span>{APP_NAME}</span>
        </div>
        <header className={styles.heading}>
          <h1 id="login-title">サインイン</h1>
          <p>Googleアカウントでログインして、<br />話し合いを始めましょう。</p>
        </header>
        {session.reason && LOGOUT_MESSAGES[session.reason] && <p className="notice" role="status">{logoutMessage(session.reason, session.policy?.idleDays)}</p>}
        {session.message && <p className="notice notice--error" role="alert">{session.message}</p>}
        <button className={styles.google} onClick={() => void login()} disabled={busy}>
          <svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285f4" d="M43.6 24.5c0-1.5-.1-2.9-.4-4.3H24v8.1h11a9.4 9.4 0 0 1-4.1 6.2v5.2h6.6c3.9-3.6 6.1-8.8 6.1-15.2Z"/><path fill="#34a853" d="M24 44c5.5 0 10.1-1.8 13.5-4.9l-6.6-5.2c-1.8 1.2-4.1 1.9-6.9 1.9-5.3 0-9.8-3.6-11.4-8.4H5.8v5.4A20.4 20.4 0 0 0 24 44Z"/><path fill="#fbbc05" d="M12.6 27.4a12.2 12.2 0 0 1 0-7.8v-5.4H5.8a20.3 20.3 0 0 0 0 18.6l6.8-5.4Z"/><path fill="#ea4335" d="M24 11.2c3 0 5.6 1 7.7 3l5.8-5.8A19.4 19.4 0 0 0 24 3 20.4 20.4 0 0 0 5.8 14.2l6.8 5.4c1.6-4.8 6.1-8.4 11.4-8.4Z"/></svg>
          <span>{busy ? "サインインしています…" : "Googleで続行"}</span>
        </button>
        {error && <p className="notice notice--error" role="alert">{error}</p>}
      </section>
      <aside className={styles.hero} aria-label={`${APP_NAME}について`}>
        <div className={styles.illustration} aria-hidden="true">
          <span className={styles.orbit} />
          <div className={styles.discussion}>
            <div className={styles.windowBar}><i /><i /><i /><span>{APP_NAME}</span></div>
            <div className={styles.message}><span>「どう思う？」</span><i /><i /></div>
            <div className={styles.reply}><span>ひとりひとりの考えを。</span><i /></div>
            <div className={styles.insight}><span>✦</span><div>まだ話されていない<br /><strong>視点が見つかりました</strong></div></div>
          </div>
          <span className={styles.bubbleOne}>“</span><span className={styles.bubbleTwo}>✦</span>
        </div>
        <div className={styles.heroCopy}><h2>話す前に、全員の考えを。</h2><p>埋もれた意見に気づき、<br />話し合いを一歩先へ。</p></div>
      </aside>
      </div>
    </main>
  );
}
