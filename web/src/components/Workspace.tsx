"use client";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { AppShell } from "@/components/shell";
import { JoinForm } from "@/components/JoinForm";
import { ProfileForm } from "@/components/host/ProfileForm";
import { Loading } from "@/components/ui";
import { signOutHost, useHostUser, useIsTeacher } from "@/lib/hostAuth";
import { getNextGoal } from "@/lib/local";
import { sessionRequest } from "@/lib/session";

/**
 * ホーム・これまでの議論・設定（Figma「最新」02-S 182:773 / 02-T 182:141 / 06 182:1734 / スマホ 200:100）。
 * 骨組みは AppShell（上の帯・左のメニュー「ホーム・設定」・灰色の角丸パネル。スマホは「≡」で開く）。
 * #80 で入った機能（Gemini のテーマ案・履歴の検索・プロフィール）は、この骨組みの中に置く。
 */
type View = "home" | "history" | "settings";
interface Discussion { sessionId: string; title: string; theme: string; phase: string; ended?: boolean; role: string; groupId?: string | null; className?: string }

const ended = (r: Discussion) => r.ended || r.phase === "closed";
/** 一覧の右の小さなラベル：「グループ1・終了」、自分が作った議論は「準備中」 */
function chip(r: Discussion) {
  const state = ended(r) ? "終了" : r.phase === "collecting" ? "準備中" : "進行中";
  // 自分が作った議論は状態だけ（Figma 02-T）。参加した議論はグループも添える
  if (r.role === "host") return state;
  return `${r.groupId ? `グループ${r.groupId}` : "参加者"}・${state}`;
}

export function Workspace({ view }: { view: View }) {
  const user = useHostUser(), teacher = useIsTeacher(), router = useRouter();
  const [rooms, setRooms] = useState<Discussion[]>(), [error, setError] = useState("");
  const [goal, setGoal] = useState<string>();
  const [filter, setFilter] = useState("");
  const [saved, setSaved] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => { setGoal(getNextGoal()?.text); }, []);
  useEffect(() => {
    if (!user) return;
    let active = true;
    sessionRequest<{ sessions: Discussion[] }>("/discussions")
      .then(({ sessions }) => { if (active) setRooms(sessions); })
      .catch(() => { if (active) setError("議論の一覧を読み込めませんでした。接続を確認して、再読み込みしてください。"); });
    return () => { active = false; };
  }, [user]);

  if (!user) return <Loading />;

  const list = (items: Discussion[]) => (
    <ul className="ws-list">
      {items.map((r) => (
        <li key={r.sessionId}>
          <Link href={`/rooms/${r.sessionId}`} className="session-row mvp-session-link">
            <span className="session-row__text">
              {r.className && <span className="session-row__class">{r.className}</span>}
              <span className="session-row__title">{r.theme || r.title}</span>
            </span>
            <span className="tag">{chip(r)}</span>
            <ChevronRight className="session-row__chevron" size={18} aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );

  if (view === "settings") {
    return (
      <AppShell title="設定">
        <div className="flow ws ws-settings">
          <section className="flow-card" aria-labelledby="profile-title">
            <h2 id="profile-title" className="ws-card-title">プロフィール</h2>
            <ProfileForm defaultName={user.displayName ?? ""} submitLabel="保存する" onSaved={() => setSaved(true)} />
            {saved && <p role="status">保存しました。</p>}
            <div className="ws-account">
              <p className="t-note">ログイン中：{user.email}</p>
              <button className="btn" disabled={busy} onClick={async () => {
                setBusy(true);
                try { await signOutHost(); router.replace("/"); }
                catch { setError("ログアウトできませんでした。接続を確認してください。"); setBusy(false); }
              }}>{busy ? "ログアウトしています…" : "ログアウト"}</button>
            </div>
            {error && <p className="notice notice--error" role="alert">{error}</p>}
          </section>
          <nav className="ws-links" aria-label="そのほかの設定">
            <Link href="/sessions">端末とセッション<ChevronRight size={16} aria-hidden="true" /></Link>
            <Link href="/about">使い方とプライバシー<ChevronRight size={16} aria-hidden="true" /></Link>
          </nav>
        </div>
      </AppShell>
    );
  }

  if (view === "history") {
    const visible = (rooms ?? []).filter((r) => `${r.theme} ${r.title} ${r.className ?? ""}`.toLowerCase().includes(filter.trim().toLowerCase()));
    return (
      <AppShell title="これまでの議論" back="/home">
        <div className="flow ws ws-wide">
          <label className="field">
            <span className="field__label">議論を探す</span>
            <input className="input" type="search" aria-label="履歴を検索" placeholder="テーマやクラス名で探す" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
          {error && <p className="notice notice--error" role="alert">{error}</p>}
          {!rooms && !error && <p className="t-note" role="status">読み込んでいます…</p>}
          {rooms && <p className="t-note">{visible.length}件の議論</p>}
          {rooms && visible.length === 0 && <p className="empty">{filter ? "一致する議論はありません。別の言葉で探してください。" : "参加した議論が、ここに並びます。"}</p>}
          {list(visible)}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell eyebrow="Topos" title="あなたのホーム">
      <div className="flow ws ws-wide">
        {/* 学生は参加が主役（UIフィードバック：入口は6桁のコードかカメラ）。教員のホームは Figma 02-T どおり作成から（参加は /join で） */}
        {!teacher && <Suspense><JoinForm /></Suspense>}
        {teacher && (
          <section className="flow-card" aria-labelledby="create-title">
            <h2 id="create-title" className="ws-card-title">新しい議論を始める</h2>
            <div className="home-actions">
              <Link className="btn btn--blue" href="/host/new">議論を作る</Link>
              <Link className="btn ws-gemini" href="/host/new#ideas"><Image src="/brand/gemini.png" width={18} height={18} alt="" aria-hidden="true" />Geminiでテーマを考える</Link>
            </div>
          </section>
        )}
        {goal && (
          <section className="flow-card" aria-labelledby="goal-title">
            <h2 id="goal-title" className="ws-card-title">前回の目標</h2>
            <p>{goal}</p>
          </section>
        )}
        <section aria-labelledby="mine-title" className="ws-section">
          <div className="ws-section__head">
            <h2 id="mine-title" className="ws-section__title">{teacher ? "あなたのセッション" : "これまでの議論"}</h2>
            {rooms && rooms.length > 3 && <Link href="/history" className="ws-more">すべて見る<ChevronRight size={16} aria-hidden="true" /></Link>}
          </div>
          {error && <p className="notice notice--error" role="alert">{error}</p>}
          {!rooms && !error && <p className="t-note" role="status">読み込んでいます…</p>}
          {rooms?.length === 0 && <p className="empty">参加した議論が、ここに並びます。</p>}
          {rooms && list(rooms.slice(0, 3))}
        </section>
      </div>
    </AppShell>
  );
}
