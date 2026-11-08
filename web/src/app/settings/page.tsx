"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loading } from "@/components/ui";
import { AppShell } from "@/components/shell";
import { signOutHost, useHostUser } from "@/lib/hostAuth";
import styles from "./settings.module.css";


/** アカウント情報と端末管理。プロフィールの編集は提供しない。 */
export default function SettingsPage() {
  const router = useRouter();
  const user = useHostUser();
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
    <div className={styles.settings}>
    <AppShell title="設定">
      <div className={styles.content}>
        <section className={styles.identity} aria-label="Googleアカウント">
          <span className={styles.accountAvatar} aria-hidden="true">{(user.displayName || user.email || "G").trim().charAt(0).toUpperCase()}</span>
          <div><h2>{user.displayName || "Googleアカウント"}</h2><p>{user.email || "Googleアカウント"}</p></div>
        </section>
        <section className={styles.card} aria-labelledby="account-title">
          <h2 id="account-title" className={styles.cardTitle}>アカウント</h2>
          <Link className={styles.settingRow} href="/sessions"><SettingsIcon name="device" /><span>ログイン端末</span><span className={styles.chevron} aria-hidden="true">›</span></Link>
          <Link className={styles.settingRow} href="/classroom"><SettingsIcon name="device" /><span>Classroom連携</span><span className={styles.chevron} aria-hidden="true">›</span></Link>
          <Link className={styles.settingRow} href="/about"><SettingsIcon name="privacy" /><span>プライバシー</span><span className={styles.chevron} aria-hidden="true">›</span></Link>
        </section>
        <button className={styles.logout} onClick={async () => { await signOutHost(); router.push("/"); }}><SettingsIcon name="logout" />ログアウト</button>
      </div>
    </AppShell>
    </div>
  );
}

function SettingsIcon({ name }: { name: "account" | "device" | "privacy" | "logout" }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {name === "account" && <><circle cx="12" cy="12" r="10" /><circle cx="12" cy="8" r="3" /><path d="M5 19a7 7 0 0 1 14 0" /></>}
      {name === "device" && <><rect x="4" y="4" width="16" height="12" rx="1" /><path d="M2 20h20M9 16v4m6-4v4" /></>}
      {name === "privacy" && <path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4Z" />}
      {name === "logout" && <><path d="M10 3H4v18h6M8 12h14m-5-5 5 5-5 5" /></>}
    </svg>
  );
}
