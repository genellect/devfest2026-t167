"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Home, Menu, SlidersHorizontal } from "lucide-react";
import { useHostUser } from "@/lib/hostAuth";
import { useGeminiSource } from "@/components/ui";

/**
 * 画面の骨組み（デザイン「黒板と付箋」）。上に1本の帯だけを置き、左のメニューは持たない（Docs「UIフィードバック」：
 * ヘッダーは最小限、使い方のボタンは不要、次に何をするかを画面そのもので伝える）。
 * - 左上：「Topos」でホームへ（教員・学生共通）。議論の途中では「←」で戻る
 * - 右上：アカウントの丸。押すと設定（端末とセッション、使い方とプライバシー、ログアウト）
 * - tone="board"：教室に投影する教員の部屋。画面全体を黒板の色にする
 * onLeave は、議論中に別の画面へ移るときの確認（録音を送っていないときなど）。false を返すと移動しない。
 */
export function AppShell({ title, eyebrow, steps, status, actions, children, onLeave, wide, nav = true, back, tone = "paper", className, account = true, showDemo = true }: {
  title: string; eyebrow?: React.ReactNode; steps?: React.ReactNode; actions?: React.ReactNode;
  children: React.ReactNode; onLeave?: () => boolean; wide?: boolean;
  /** false にするとホームとアカウントへの入口を出さない（ログイン前に開ける画面） */
  nav?: boolean;
  /** 議論の流れの中では、ロゴの代わりに「←」でホームへ戻る */
  back?: string;
  /** 今の段階を文字で（読み上げ用。進み具合の表示はPC用とスマホ用の2つを描くので、こちらは1つだけ置く） */
  status?: string;
  /** paper：学生と普段の画面（紙）、board：教室に投影する教員の部屋（黒板） */
  tone?: "paper" | "board";
  className?: string;
  account?: boolean;
  showDemo?: boolean;
}) {
  // デモデータ（Gemini のモック）のときは、どの画面でも上の帯に1回だけ出す。各カードには出さない（ui.tsx の SourceTag）
  const demo = useGeminiSource() === "mock";
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);
  const guard = (e: React.MouseEvent) => { if (onLeave && !onLeave()) e.preventDefault(); };
  const menu = nav && tone !== "board";

  return (
    <div className={`shell${className ? ` ${className}` : ""}`} data-tone={tone} data-wide={wide || undefined} data-menu={menu || undefined}>
      <header className="shell__bar">
        {/* スマホ：議論の流れの中は「←」、それ以外は「≡」でメニューを開く（Figma「最新」のスマホのルール） */}
        {nav && back
          ? <Link href={back} className="shell__back" aria-label="ホーム" onClick={guard}><ArrowLeft size={22} strokeWidth={1.75} aria-hidden="true" /></Link>
          : menu ? <button type="button" className="shell__menu" aria-label="メニュー" aria-expanded={open} aria-controls="shell-nav" onClick={() => setOpen(!open)}><Menu size={22} strokeWidth={1.75} aria-hidden="true" /></button>
            : <span className="shell__brand">Topos</span>}
        <div className="shell__title">
          {eyebrow && <p className="shell__eyebrow">{eyebrow}</p>}
          <h1 className="shell__name">{title}</h1>
        </div>
        {steps && <div className="shell__steps">{steps}</div>}
        {status ? <span className="sr-only" data-testid="phase">{status}</span> : null}
        {demo && showDemo && <span className="tag tag--yellow shell__demo">デモデータ</span>}
        {actions && <div className="shell__actions">{actions}</div>}
        {nav && account && <Account onClick={guard} />}
      </header>
      {steps && <div className="shell__steps-mobile">{steps}</div>}
      <div className="shell__body">
        {/* 左のメニュー（Figma「最新」：ホーム・設定）。PC・タブレットではいつも出し、スマホでは「≡」で開く */}
        {menu && <nav id="shell-nav" className="shell__nav" data-open={open || undefined} aria-label="メニュー">
          <p className="shell__nav-brand">Topos</p>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="shell__link" onClick={guard} aria-current={n.match.some((m) => pathname === m || pathname?.startsWith(`${m}/`)) ? "page" : undefined}>
              <n.Icon size={22} strokeWidth={1.75} aria-hidden="true" /><span>{n.label}</span>
            </Link>
          ))}
        </nav>}
        {open && <button type="button" className="shell__scrim" aria-label="メニューを閉じる" onClick={() => setOpen(false)} />}
        <main className="shell__panel">{children}</main>
      </div>
    </div>
  );
}

const NAV = [
  { href: "/home", label: "ホーム", Icon: Home, match: ["/home", "/history", "/join", "/host/new", "/rooms"] },
  { href: "/settings", label: "設定", Icon: SlidersHorizontal, match: ["/settings", "/sessions", "/about"] },
];

/** 右上のアカウント。名前の1文字目を丸で表示し、設定を開く */
function Account({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  const user = useHostUser();
  if (!user) return null;
  const name = user.displayName || user.email || "?";
  return (
    <Link href="/settings" className="shell__account" aria-label={`設定（${name}）`} title="設定" onClick={onClick}>
      <span aria-hidden="true">{name.trim().charAt(0).toUpperCase()}</span>
    </Link>
  );
}

/**
 * 段階の表示。事前意見 → 議論 → 結論 → 結果 の4つ。
 * PC・タブレットでは丸と線で、スマホでは「2/4 議論」と4本の線で示す。
 */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="stepper">
      <ol className="stepper__list" aria-label="進み具合">
        {steps.map((label, i) => (
          <li key={label} className="stepper__item" aria-current={i === current ? "step" : undefined} data-done={i < current || undefined}>
            <span className="stepper__circle" aria-hidden="true">{i < current ? "✓" : i + 1}</span>
            <span className="stepper__label">{label}</span>
          </li>
        ))}
      </ol>
      <p className="stepper__compact" aria-hidden="true"><span>{current + 1}/{steps.length}</span>{steps[current]}</p>
      <div className="stepper__bars" aria-hidden="true">
        {steps.map((label, i) => <span key={label} data-state={i < current ? "done" : i === current ? "now" : undefined} />)}
      </div>
    </div>
  );
}
