"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Header, Loading } from "@/components/ui";
import { ProfileForm } from "@/components/host/ProfileForm";
import { canUseTestHost, signInAsHost, signInAsTestHost, useHostUser } from "@/lib/hostAuth";

/** 先生の新規登録。1. Google で認証 → 2. プロフィールを登録 */
export default function Signup() {
  const router = useRouter();
  const user = useHostUser();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function auth(how: () => Promise<void>) {
    setBusy(true); setError("");
    try { await how(); } catch (e) { setError(`登録できませんでした：${(e as Error).message}`); }
    finally { setBusy(false); }
  }
  if (user === undefined) return <Loading />;

  return (
    <main className="screen">
      <Header title="先生として新規登録"><Link className="btn btn--small" href="/">トップに戻る</Link></Header>
      <div className="body body--center">
        <div className="box box--lg card" style={{ width: "min(720px, 100%)" }}>
          <ol className="steps" aria-label="登録の手順">
            <li aria-current={!user ? "step" : undefined} data-done={!!user}>1. アカウント</li>
            <li aria-current={user ? "step" : undefined}>2. プロフィール</li>
          </ol>
          {!user ? (
            <>
              <h2 className="card__title">Google アカウントで登録する</h2>
              <p className="t-label">学校や個人の Google アカウントで登録できます。パスワードを新しく作る必要はありません。</p>
              <button className="btn btn--yellow btn--block" onClick={() => auth(signInAsHost)} disabled={busy}>{busy ? "登録しています…" : "Googleで登録"}</button>
              {canUseTestHost && <button className="btn btn--block" onClick={() => auth(signInAsTestHost)} disabled={busy}>テスト用の先生で登録（エミュレータ）</button>}
              {error && <p className="notice notice--error" role="alert">{error}</p>}
              <p className="t-note">すでに登録している方は <Link href="/host" style={{ color: "inherit" }}>ログイン</Link></p>
            </>
          ) : (
            <>
              <h2 className="card__title">プロフィールを登録する</h2>
              <p className="t-label">画面の表示に使います。あとから設定で変えられます。</p>
              <ProfileForm defaultName={user.displayName ?? ""} submitLabel="登録してはじめる" onSaved={() => router.push("/host")} />
            </>
          )}
        </div>
      </div>
    </main>
  );
}
