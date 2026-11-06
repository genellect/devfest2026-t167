"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loading } from "@/components/ui";
import { AppShell } from "@/components/shell";
import { callApi } from "@/lib/api";
import { useHostUser } from "@/lib/hostAuth";
import { useEffect } from "react";
import { addHistory, getProfile, setRoomLabel } from "@/lib/local";


/** S2 ディスカッションを作る */
export default function NewRoom() {
  const router = useRouter();
  const user = useHostUser();
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

  if (user === undefined) return <Loading />;
  if (user === null) {
    return (
      <main className="screen"><div className="body body--center">
        <div className="box box--lg card card--narrow"><p className="t-label">ディスカッションを作るには、Googleでログインしてください。</p>
          <Link className="btn btn--yellow" href="/">ログインする</Link></div>
      </div></main>
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
