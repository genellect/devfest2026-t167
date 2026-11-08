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
    <AppShell title="新しい議論" wide>
      <div className="create">
        <form className="panel create__form" onSubmit={create} aria-labelledby="new-title">
          <h2 id="new-title" className="t-md">テーマを決める</h2>
          <div className="field">
            <label className="field__label" htmlFor="title">テーマ</label>
            <input id="title" className="input" value={title} maxLength={100} required placeholder="例：大学の課題提出でAIの利用を認めるべきか" onChange={(e) => setTitle(e.target.value)} />
            <p className="field__hint">賛成と反対、条件付きなど、考えが分かれそうな問いにすると、まだ話されていない論点が見つかりやすくなります。</p>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="label">クラス名（任意）</label>
            <input id="label" className="input" value={label} maxLength={40} placeholder="例：2年3組" onChange={(e) => setLabel(e.target.value)} />
            <p className="field__hint">作った議論の一覧で見分けるために使います。学生には表示しません。</p>
          </div>
          {error && <p className="notice notice--error" role="alert">{error}</p>}
          <div className="home-actions"><button className="btn btn--blue" type="submit" disabled={busy || !title.trim()}>{busy ? "作成しています…" : "作成する"}</button></div>
        </form>
        {/* 作ったあとに起きること（実際に順に進むので番号を付ける） */}
        <aside className="create__next" aria-labelledby="next-steps-title">
          <h2 id="next-steps-title" className="t-sm">作ったあとの流れ</h2>
          <ol className="steps-list">
            <li><b>参加コードと QR を映す</b><span>上の帯の「投影画面」を開き、プロジェクターに映します。</span></li>
            <li><b>学生が事前の意見を書く</b><span>本文は本人だけが見られ、教員にも届きません。</span></li>
            <li><b>議論を始める</b><span>AI が、まだ話されていない論点を黄色の付箋で提案します。全員に表示するか、見送るかを選びます。</span></li>
            <li><b>結論の中身を確かめる</b><span>終わったら全員が結論を一文で書き、理解の分かれ方を色の付箋で見ます。</span></li>
          </ol>
        </aside>
      </div>
    </AppShell>
  );
}
