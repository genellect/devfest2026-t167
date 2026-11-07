"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useHostUser, useIsTeacher } from "@/lib/hostAuth";

/**
 * 画面の骨組み（Figma「最新」）。上に64pxのバー、左に196pxのメニュー（ホーム・設定）、右に灰色の角丸パネル。
 * スマホ（768px未満）では左のメニューを隠し、バーの「≡」で開く。
 * onLeave は、議論中に別の画面へ移るときの確認（録音を送っていないときなど）。false を返すと移動しない。
 */
export function AppShell({ title, eyebrow, steps, status, actions, children, onLeave, wide, nav = true, back }: {
  title: string; eyebrow?: React.ReactNode; steps?: React.ReactNode; actions?: React.ReactNode;
  children: React.ReactNode; onLeave?: () => boolean; wide?: boolean;
  /** false にすると左のメニューを出さない（ログイン前に開ける画面） */
  nav?: boolean;
  /** 議論の流れの中では、スマホの「≡」の代わりに「←」でホームへ戻る（Figma のスマホのルール） */
  back?: string;
  /** 今の段階を文字で（読み上げ用。進み具合の表示はPC用とスマホ用の2つを描くので、こちらは1つだけ置く） */
  status?: string;
}) {
  const pathname = usePathname();
  // 教員と学生でホームを分ける（教員は /teacher、学生は /home）
  const menu = useIsTeacher() ? TEACHER_NAV : NAV;
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);
  const guard = (e: React.MouseEvent) => { if (onLeave && !onLeave()) e.preventDefault(); };

  return (
    <div className="shell" data-wide={wide || undefined} data-nav={nav || undefined}>
      <header className="shell__bar">
        {nav && (back
          ? <Link href={back} className="shell__menu" aria-label="ホーム" onClick={guard}><Icon name="back" /></Link>
          : <button type="button" className="shell__menu" aria-label="メニュー" aria-expanded={open} aria-controls="shell-nav" onClick={() => setOpen(!open)}>
            <Icon name="menu" />
          </button>)}
        <div className="shell__title">
          {eyebrow && <p className="shell__eyebrow">{eyebrow}</p>}
          <h1 className="shell__name">{title}</h1>
        </div>
        {steps}
        {status ? <span className="sr-only" data-testid="phase">{status}</span> : null}
          {actions && <div className="shell__actions">{actions}</div>}
        <Account onClick={guard} />
      </header>
      {steps && <div className="shell__steps-mobile">{steps}</div>}
      <div className="shell__body">
        {nav && <nav id="shell-nav" className="shell__nav" data-open={open || undefined} aria-label="メニュー">
          <p className="shell__brand">Discuss</p>
          {menu.map((n) => (
            <Link key={n.href} href={n.href} className="shell__link" onClick={guard}
              aria-current={n.match.some((m) => pathname === m) ? "page" : undefined}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
            </Link>
          ))}
        </nav>}
        {open && <button type="button" className="shell__scrim" aria-label="メニューを閉じる" onClick={() => setOpen(false)} />}
        <main className="shell__panel">{children}</main>
      </div>
    </div>
  );
}

const SETTINGS = { href: "/host/profile", label: "設定", icon: "settings" as const, match: ["/host/profile", "/sessions"] };
const NAV = [
  { href: "/home", label: "ホーム", icon: "home" as const, match: ["/home", "/join"] },
  SETTINGS,
];
const TEACHER_NAV = [
  { href: "/teacher", label: "ホーム", icon: "home" as const, match: ["/teacher", "/host/new"] },
  SETTINGS,
];

/** 右上のアカウント。名前の1文字目を丸で表示し、設定を開く */
function Account({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  const user = useHostUser();
  if (!user) return null;
  const name = user.displayName || user.email || "?";
  return (
    <Link href="/host/profile" className="shell__account" aria-label={`アカウント（${name}）`} title={name} onClick={onClick}>
      <span aria-hidden="true">{name.trim().charAt(0).toUpperCase()}</span>
    </Link>
  );
}

/**
 * 段階の表示。PC・タブレットでは「① 事前意見 — ② 議論 — ③ 結論 — ④ 結果」を丸と線で、
 * スマホでは「ステップ 2/4：議論」と4本の線で示す（Figma のスマホのルール）。
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
      <p className="stepper__compact" aria-hidden="true">ステップ {current + 1}/{steps.length}：{steps[current]}</p>
      <div className="stepper__bars" aria-hidden="true">
        {steps.map((label, i) => <span key={label} data-state={i < current ? "done" : i === current ? "now" : undefined} />)}
      </div>
    </div>
  );
}

/** メニューの絵（Material Symbols の形）。意味はラベルの文字で伝えるので、読み上げからは外す */
function Icon({ name }: { name: "home" | "settings" | "menu" | "back" }) {
  return (
    <svg className="shell__icon" width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      {name === "home" && <path d="M4 21V9l8-6 8 6v12h-6v-7h-4v7H4Z" />}
      {name === "settings" && <path d="M3 17v2h6v-2H3ZM3 5v2h10V5H3Zm10 16v-2h8v-2h-8v-2h-2v6h2ZM7 9v2H3v2h4v2h2V9H7Zm14 4v-2H11v2h10Zm-6-4h2V7h4V5h-4V3h-2v6Z" />}
      {name === "menu" && <path d="M3 18v-2h18v2H3Zm0-5v-2h18v2H3Zm0-5V6h18v2H3Z" />}
      {name === "back" && <path d="m7.8 13 5.6 5.6L12 20l-8-8 8-8 1.4 1.4L7.8 11H20v2H7.8Z" />}
    </svg>
  );
}
