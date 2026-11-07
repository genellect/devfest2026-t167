"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loading } from "@/components/ui";
import { AppShell } from "@/components/shell";
import { callApi } from "@/lib/api";
import { useHostUser, useIsTeacher } from "@/lib/hostAuth";
import { addHistory, getProfile, setRoomLabel } from "@/lib/local";


/** 議論を作る（教員だけ） */
export default function NewRoom() {
  const router = useRouter();
  const user = useHostUser();
  const teacher = useIsTeacher();
  const [title, setTitle] = useState("");
  const [label, setLabel] = useState("");
  useEffect(() => { setLabel(getProfile()?.className ?? ""); }, []);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // 入力はテーマとクラス名だけ。グループ・時間・録音はサーバーと既定値で決める（Docs「UIフィードバック」）
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const theme = title.trim(), className = label.trim();
      const { roomId } = await callApi<{ roomId: string }>("/rooms", { title: theme, theme, ...(className ? { className } : {}), flowVersion: 1 });
      if (className) setRoomLabel(roomId, className);
      addHistory("host", { roomId, title: theme });
      router.push(`/rooms/${roomId}`);
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }

  if (user === undefined || (user && teacher === undefined)) return <Loading />;
  if (user === null) {
    return (
      <main className="screen"><div className="body body--center">
        <div className="box box--lg card card--narrow"><p className="t-label">議論を作るには、Googleでログインしてください。</p>
          <Link className="btn btn--yellow" href="/">ログインする</Link></div>
      </div></main>
    );
  }
  if (!teacher) {
    // 作成は招待された教員だけ。APIでも同じ条件で断る
    return (
      <AppShell title="新しい議論">
        <div className="flow">
          <section className="flow-card">
            <p role="status">議論を作れるのは、招待された教員のアカウントだけです。</p>
            <p className="t-note">参加するときは、教員の画面に出ている6桁の数字を入力します。</p>
            <div className="home-actions"><Link className="btn btn--blue" href="/join">参加コードを入力する</Link></div>
          </section>
        </div>
      </AppShell>
    );
  }
  return (
    <AppShell title="新しい議論">
      <div className="flow">
        <form className="flow-card" onSubmit={create} aria-labelledby="new-title">
          <h2 id="new-title" className="flow-card__title">議論の準備</h2>
          <div className="field">
            <label className="field__label" htmlFor="title">テーマ</label>
            <input id="title" className="input" value={title} maxLength={100} required placeholder="例：大学の課題提出でAIの利用を認めるべきか" onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="label">クラス名（任意）</label>
            <input id="label" className="input" value={label} maxLength={40} placeholder="例：2年3組" onChange={(e) => setLabel(e.target.value)} />
          </div>
          {error && <p className="notice notice--error" role="alert">{error}</p>}
          <div className="home-actions"><button className="btn btn--blue" type="submit" disabled={busy || !title.trim()}>{busy ? "作成しています…" : "作成する"}</button></div>
        </form>
      </div>
    </AppShell>
  );
}
