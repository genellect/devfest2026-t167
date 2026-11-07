"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { Loading } from "@/components/ui";
import { JoinForm } from "@/components/JoinForm";
import { AppShell } from "@/components/shell";
import { useHostUser } from "@/lib/hostAuth";
import { getNextGoal, getRoomLabel } from "@/lib/local";
import { sessionRequest } from "@/lib/session";

interface Discussion { sessionId: string; title: string; theme: string; phase: string; ended?: boolean; role: "host" | "participant"; groupId: string | null; className?: string }

/** 一覧の右の小さなラベル：「グループ1 · 終了」「ホスト · 準備中」 */
function chip(s: Discussion) {
  const who = s.role === "host" ? "ホスト" : s.groupId ? `グループ${s.groupId}` : "参加者";
  const state = s.ended ? "終了" : s.phase === "collecting" ? "準備中" : "進行中";
  return `${who} · ${state}`;
}

/** 共通ホーム（Figma「最新」02-S・02-T）。参加が主役。作成と前回の目標、これまでの議論を下に並べる */
export default function Home() {
  const user = useHostUser();
  const [sessions, setSessions] = useState<Discussion[]>([]), [error, setError] = useState("");
  const [goal, setGoal] = useState<string>();
  useEffect(() => { setGoal(getNextGoal()?.text); }, []);
  useEffect(() => {
    let active = true;
    if (user) sessionRequest<{ sessions: Discussion[] }>("/discussions").then((r) => { if (active) setSessions(r.sessions); }).catch(() => { if (active) setError("一覧を読み込めませんでした。接続を確認して、再読み込みしてください。"); });
    return () => { active = false; };
  }, [user]);
  if (!user) return <Loading />;
  return (
    <AppShell title="あなたのホーム">
      <div className="flow">
        <div className="mvp-actions home-join-area">
          <Suspense><JoinForm /></Suspense>
        </div>
        <section className="flow-card home-create" aria-labelledby="create-title">
          <h2 id="create-title" className="flow-card__title">新しい議論を始める</h2>
          <div className="home-actions"><Link className="btn" href="/host/new">議論を作る</Link></div>
        </section>
        {goal && (
          <section className="flow-card" aria-labelledby="goal-title">
            <h2 id="goal-title" className="flow-card__title">前回の目標</h2>
            <p>{goal}</p>
          </section>
        )}
        <section className="flow-quiet" aria-labelledby="mine">
          <h2 id="mine" className="section-title">これまでの議論</h2>
          {error && <p className="notice notice--error" role="alert">{error}</p>}
          {!sessions.length && !error && <p className="t-note">参加した議論が、ここに並びます。</p>}
          {sessions.map((s) => {
            const label = s.className || getRoomLabel(s.sessionId);
            return (
              <Link key={s.sessionId} href={`/rooms/${s.sessionId}`} className="session-row mvp-session-link">
                <span className="session-row__text">
                  {label && <span className="session-row__class">{label}</span>}
                  <span className="session-row__title">{s.theme || s.title}</span>
                </span>
                <span className="tag">{chip(s)}</span>
                <span className="session-row__chevron" aria-hidden="true">›</span>
              </Link>
            );
          })}
        </section>
      </div>
    </AppShell>
  );
}
