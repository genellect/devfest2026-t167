"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Header } from "@/components/ui";
import { useRouter } from "next/navigation";
import { signOutHost, useHostUser } from "@/lib/hostAuth";
import { getHistory, getNextGoal, getReflection, setRole, shortDate, type HistoryItem } from "@/lib/local";

/** H2 生徒のホーム：前回決めた目標、今日の議論への入口、これまでの議論 */
export default function StudentHome() {
  const router = useRouter();
  const account = useHostUser(); // Google でログインしていれば User、参加コードだけで来た人は null
  const [goal, setGoal] = useState<{ text: string; at: number } | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  useEffect(() => { setGoal(getNextGoal()); setHistory(getHistory("participant")); }, []);

  return (
    <main className="screen">
      <Header title="あなたのホーム">
        <Link className="btn btn--small" href="/about">使い方</Link>
        {account && <button className="btn btn--small" onClick={() => { setRole(account.uid, "host"); router.push("/host"); }}>先生として使う</button>}
        {account
          ? <button className="btn btn--small" onClick={async () => { await signOutHost(); router.push("/"); }}>ログアウト</button>
          : <Link className="btn btn--small" href="/">ログイン</Link>}
      </Header>
      <div className="body body--tablet">
        <div className="row" style={{ flex: "0 0 auto" }}>
          <section className="box box--md box--yellow pad stack" style={{ flex: 2 }}>
            <p className="t-label">前回決めた、次に挑戦したいこと</p>
            {goal ? (
              <>
                <p className="t-lg">{goal.text}</p>
                <p className="t-small">{shortDate(goal.at)}の振り返りより</p>
              </>
            ) : (
              <p className="t-md">議論のあとに、次に挑戦したいことをここに残せます。</p>
            )}
          </section>
          <section className="box box--md box--blue pad stack" style={{ justifyContent: "center" }}>
            <h2 className="t-md">今日の議論に参加する</h2>
            <Link className="btn btn--yellow btn--block" href="/join">参加コードを入力</Link>
          </section>
        </div>
        <section className="box box--md pad stack" style={{ flex: 1 }}>
          <h2 className="t-sm">これまでの議論</h2>
          {history.length === 0 && <p className="empty">参加した議論が、この端末にここに並びます。</p>}
          {history.map((h) => {
            const r = getReflection(h.roomId);
            return (
              <div key={h.roomId} className="box box--bg pad" style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <span className="t-label">{shortDate(h.at)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p className="t-sm">{h.title}</p>
                  {r.goal && <p className="t-small">目標：{r.goal}{r.achieved ? `　${r.achieved}` : ""}</p>}
                </div>
                <Link className="btn btn--small" href={`/rooms/${h.roomId}`}>振り返りを見る</Link>
              </div>
            );
          })}
        </section>
      </div>
    </main>
  );
}
