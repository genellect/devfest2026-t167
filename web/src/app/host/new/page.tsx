"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Header, Loading } from "@/components/ui";
import { callApi } from "@/lib/api";
import { useHostUser } from "@/lib/hostAuth";
import { useEffect } from "react";
import { addHistory, getProfile, setDuration, setRoomLabel } from "@/lib/local";

const DURATIONS = [10, 15, 20, 30];
const GROUPS = [1, 2, 3, 4, 5, 6, 7, 8];

/** S2 部屋を作る */
export default function NewRoom() {
  const router = useRouter();
  const user = useHostUser();
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState(15);
  const [groups, setGroups] = useState(6);
  const [label, setLabel] = useState("");
  useEffect(() => { setLabel(getProfile()?.className ?? ""); }, []);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const { roomId } = await callApi<{ roomId: string }>("/rooms", { title: title.trim(), groups });
      setDuration(roomId, minutes);
      if (label.trim()) setRoomLabel(roomId, label.trim());
      addHistory("host", { roomId, title: title.trim() });
      router.push(`/rooms/${roomId}`);
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }

  if (user === undefined) return <Loading />;
  if (user === null) {
    return (
      <main className="screen"><div className="body body--center">
        <div className="box box--lg card card--narrow"><p className="t-label">部屋を作るには、先生としてログインしてください。</p>
          <Link className="btn btn--yellow" href="/host">ログインする</Link></div>
      </div></main>
    );
  }
  return (
    <main className="screen">
      <Header title="新しい議論を作る"><Link className="btn btn--small" href="/host">ホームに戻る</Link></Header>
      <div className="body body--center">
        <form className="box box--lg card" style={{ width: "min(720px, 100%)" }} onSubmit={create}>
          <h2 className="card__title">今日の議論を準備する</h2>
          <div className="field">
            <label className="field__label" htmlFor="label">クラス・授業名（任意）</label>
            <input id="label" className="input" value={label} maxLength={40} placeholder="例：2年3組 探究の授業" onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="title">テーマ</label>
            <input id="title" className="input" value={title} maxLength={100} placeholder="例：大学生のうちに経験すべきバイトは？" onChange={(e) => setTitle(e.target.value)} />
          </div>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field__label" style={{ marginBottom: 6 }}>グループの数</legend>
            <div className="choices">
              {GROUPS.map((n) => <button key={n} type="button" className="choice" style={{ minWidth: 56 }} aria-pressed={groups === n} onClick={() => setGroups(n)}>{n}</button>)}
            </div>
            <p className="field__hint">生徒は参加した順に、グループへ割り当てられます。</p>
          </fieldset>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field__label" style={{ marginBottom: 6 }}>議論の時間</legend>
            <div className="choices">
              {DURATIONS.map((m) => <button key={m} type="button" className="choice" aria-pressed={minutes === m} onClick={() => setMinutes(m)}>{m}分</button>)}
            </div>
          </fieldset>
          {error && <p className="notice notice--error" role="alert">{error}</p>}
          <button className="btn btn--blue btn--block" type="submit" disabled={busy || !title.trim()}>{busy ? "作っています…" : "部屋を作る"}</button>
        </form>
      </div>
    </main>
  );
}
