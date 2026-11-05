"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Header, Loading } from "@/components/ui";
import { ProfileForm } from "@/components/host/ProfileForm";
import { signOutHost, useHostUser } from "@/lib/hostAuth";
import { setRole, type Role } from "@/lib/local";

/** 初回ログインのあと：生徒か先生かを選ぶ。先生はプロフィールも登録する */
export default function Signup() {
  const router = useRouter();
  const user = useHostUser();
  const [role, choose] = useState<Role>();
  useEffect(() => { if (user === null) router.replace("/"); }, [user, router]);
  if (!user) return <Loading />;

  function pick(r: Role) {
    if (r === "student") { setRole(user!.uid, "student"); router.push("/student"); return; }
    choose("host");
  }

  return (
    <main className="screen">
      <Header title="はじめての設定">
        <button className="btn btn--small" onClick={async () => { await signOutHost(); router.push("/"); }}>別のアカウントでログイン</button>
      </Header>
      <div className="body body--center">
        {!role ? (
          <div className="stack" style={{ width: "min(900px, 100%)", gap: 24 }}>
            <h2 className="t-lg">あなたは、生徒ですか？先生ですか？</h2>
            <p className="t-label">使う画面が変わります。あとから設定で変えられます。</p>
            <div className="row">
              <button className="box box--lg pad-lg stack" style={{ textAlign: "left", cursor: "pointer", gap: 12 }} onClick={() => pick("student")}>
                <span className="t-lg">生徒</span>
                <span className="t-note">参加コードで議論に参加し、自分の振り返りと次の目標を残します。</span>
              </button>
              <button className="box box--lg box--yellow pad-lg stack" style={{ textAlign: "left", cursor: "pointer", gap: 12 }} onClick={() => pick("host")}>
                <span className="t-lg">先生</span>
                <span className="t-note">テーマとグループの数を決めて部屋を作り、議論の様子と結果を見ます。</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="box box--lg card" style={{ width: "min(720px, 100%)" }}>
            <h2 className="card__title">プロフィールを登録する</h2>
            <p className="t-label">画面の表示に使います。あとから設定で変えられます。</p>
            <ProfileForm defaultName={user.displayName ?? ""} submitLabel="登録してはじめる"
              onSaved={() => { setRole(user.uid, "host"); router.push("/host"); }} />
            <button className="btn btn--small" style={{ alignSelf: "flex-start" }} onClick={() => choose(undefined)}>役割の選択に戻る</button>
          </div>
        )}
      </div>
    </main>
  );
}
