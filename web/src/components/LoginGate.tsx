"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { reauthenticateSession, signOutHost } from "@/lib/hostAuth";
import { rememberJoinCode } from "@/lib/join-code";
import { handleSessionFailure, recordActivity, restoreSession, useAppSession } from "@/lib/session";
import { Loading } from "./ui";

/** ロック中も既存画面をマウントしたまま隠し、音声の保存完了まで待つ。 */
export function LoginGate({ children }: { children: React.ReactNode }) {
  const session = useAppSession(), { user, status } = session;
  const pathname = usePathname(), router = useRouter();
  const publicPage = pathname === "/" || pathname === "/about";
  const lastInput = useRef(Date.now()), sentAt = useRef(0), mountedPrivate = useRef(false);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  if (status === "active" && !publicPage) mountedPrivate.current = true;
  useEffect(() => {
    if (publicPage || user !== null) return;
    if (pathname === "/join") rememberJoinCode(new URLSearchParams(window.location.search).get("code") ?? "");
    mountedPrivate.current = false; router.replace("/");
  }, [pathname, publicPage, user, router]);
  useEffect(() => { if (status === "active") lastInput.current = Date.now(); }, [status]);
  useEffect(() => {
    if (status !== "active") return;
    let trailing: ReturnType<typeof setTimeout> | undefined;
    const activity = (event: Event) => {
      if (!event.isTrusted || document.hidden) return;
      lastInput.current = Date.now();
      if (Date.now() - sentAt.current >= 60_000) { sentAt.current = Date.now(); void recordActivity(); }
      else {
        clearTimeout(trailing);
        // 最後の操作から1秒でまとめる。自動タイマー単独では活動を作らない。
        trailing = setTimeout(() => { sentAt.current = Date.now(); void recordActivity(); }, 1000);
      }
    };
    const events = ["pointerdown", "keydown", "touchstart", "click", "input", "wheel"];
    events.forEach((name) => document.addEventListener(name, activity, { passive: true }));
    const timer = setInterval(() => {
      if (session.session?.isSharedDevice && session.policy && Date.now() - lastInput.current >= session.policy.sharedIdleMinutes * 60_000) void handleSessionFailure("session_locked");
    }, 1000);
    return () => { clearInterval(timer); clearTimeout(trailing); events.forEach((name) => document.removeEventListener(name, activity)); };
  }, [status, session.session?.isSharedDevice, session.policy]);
  async function action(fn: () => Promise<void>) { setBusy(true); setError(""); try { await fn(); } catch { setError("本人確認または接続を確認して、もう一度お試しください。"); } finally { setBusy(false); } }
  const blocked = status === "locked" || status === "saving";
  if (blocked) return <>
    <div hidden aria-hidden="true">{mountedPrivate.current ? children : null}</div>
    <main className="session-overlay"><section className="session-card" role="dialog" aria-modal="true" aria-label="再認証">
      <h1>{status === "saving" ? "録音を保存しています" : "もう一度、本人確認をしてください"}</h1>
      <p>学校の共用端末を安全に利用するため、画面をロックしました。</p>
      <p className="t-note">録音は停止し、この端末に保存します。再認証後に「端末とセッション」で確認できます。</p>
      {status === "locked" && <button className="btn btn--blue btn--block" onClick={() => action(reauthenticateSession)} disabled={busy}>Googleで本人確認</button>}
      {status === "locked" && <button className="btn btn--block" onClick={() => action(signOutHost)} disabled={busy}>ログアウト</button>}
      {(error || session.message) && <p role="alert">{error || session.message}</p>}
    </section></main>
  </>;
  if (status === "offline" && pathname !== "/about") return <main className="session-overlay"><section className="session-card"><p>{session.message}</p><button className="btn" onClick={() => void restoreSession()}>接続を再確認</button></section></main>;
  if (!publicPage && (!user || status !== "active")) return <Loading label="ログインとセッションを確認しています…" />;
  return children;
}
