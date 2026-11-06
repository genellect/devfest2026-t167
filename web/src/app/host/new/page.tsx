"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { TabBar } from "@/components/nav";
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
  const [name, setName] = useState("");
  const [groupSelection, setGroupSelection] = useState<"host" | "participant">("participant");
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState(15);
  const [groups, setGroups] = useState(6);
  const [recording, setRecording] = useState(true);
  const [label, setLabel] = useState("");
  useEffect(() => { setLabel(getProfile()?.className ?? ""); }, []);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const { roomId } = await callApi<{ roomId: string }>("/rooms", { title: name.trim() || title.trim(), theme: title.trim(), minutes, groups, recording, groupSelection, flowVersion: 1 });
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
        <div className="box box--lg card card--narrow"><p className="t-label">部屋を作るには、Googleでログインしてください。</p>
          <Link className="btn btn--yellow" href="/">ログインする</Link></div>
      </div></main>
    );
  }
  return (
    <main className="screen screen--tabs">
      <Header title="新しい議論を作る" nav={<TabBar role="host" />} />
      <div className="body body--center">
        <form className="box box--lg card" style={{ width: "min(720px, 100%)" }} onSubmit={create}>
          <h2 className="card__title">セッションを準備する</h2>
          <label className="field">セッション名<input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="例：アイデア検討会" /></label>
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
            <div className="choices choices--compact">
              {GROUPS.map((n) => <button key={n} type="button" className="choice" aria-pressed={groups === n} onClick={() => setGroups(n)}>{n}</button>)}
            </div>
            <p className="field__hint">参加者が選択するか、Hostが割り当てるかを設定します。</p>
          </fieldset>
          <label className="field">グループへの所属方法<select value={groupSelection} onChange={(e) => setGroupSelection(e.target.value as "host" | "participant")}><option value="participant">参加者が選択</option><option value="host">Hostが割り当て</option></select></label>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field__label" style={{ marginBottom: 6 }}>議論の時間</legend>
            <div className="choices">
              {DURATIONS.map((m) => <button key={m} type="button" className="choice" aria-pressed={minutes === m} onClick={() => setMinutes(m)}>{m}分</button>)}
            </div>
          </fieldset>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field__label" style={{ marginBottom: 6 }}>議論の録音</legend>
            <div className="choices">
              <button type="button" className="choice" aria-pressed={recording} onClick={() => setRecording(true)}>録音して分析する</button>
              <button type="button" className="choice" aria-pressed={!recording} onClick={() => setRecording(false)}>録音しない</button>
            </div>
            <p className="field__hint">録音はグループごとに1台。グループ全員の同意を画面で確かめてから始め、音声は分析のあと保存しません。</p>
          </fieldset>
          {error && <p className="notice notice--error" role="alert">{error}</p>}
          <button className="btn btn--blue btn--block" type="submit" disabled={busy || !title.trim()}>{busy ? "作っています…" : "部屋を作る"}</button>
        </form>
      </div>
    </main>
  );
}
