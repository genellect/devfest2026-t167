"use client";
import { APP_NAME } from "@/lib/brand";
import Link from "next/link";
import HistoryMenu from "./history/HistoryMenu";
import { useFixedHeader } from "@/lib/use-fixed-header";

/**
 * Google Workspace風ライトUIの共通の骨組み。上に1本の帯だけを置き、左のメニューはホーム・履歴・設定に統一する（Docs「UIフィードバック」：
 * ヘッダーは最小限、使い方のボタンは不要、次に何をするかを画面そのもので伝える）。
 * - 左上：アプリ名でホームへ（全員共通）。議論の途中では「←」で戻る
 * - 設定への入口は左のサイドバーに集約する
 * - tone="board"：既存の教員用区分。表示は全画面共通のライトUIにする
 * onLeave は、議論中に別の画面へ移るときの確認（録音を送っていないときなど）。false を返すと移動しない。
 */
export function AppShell({ title, eyebrow, steps, status, actions, children, onLeave, wide, nav = true, back, tone = "paper" }: {
  title: string; eyebrow?: React.ReactNode; steps?: React.ReactNode; actions?: React.ReactNode;
  children: React.ReactNode; onLeave?: () => boolean; wide?: boolean;
  /** false にするとナビゲーションの入口を出さない（ログイン前に開ける画面） */
  nav?: boolean;
  /** 議論の流れの中では、ロゴの代わりに「←」でホームへ戻る */
  back?: string;
  /** 今の段階を文字で（読み上げ用。進み具合の表示はPC用とスマホ用の2つを描くので、こちらは1つだけ置く） */
  status?: string;
  /** 既存の画面区分。どちらも共通のライトUIで表示する */
  tone?: "paper" | "board";
}) {
  const fixed = useFixedHeader();
  const home = "/home";
  const guard = (e: React.MouseEvent) => { if (onLeave && !onLeave()) e.preventDefault(); };

  return (
    <div ref={fixed.root} className="shell" data-tone={tone} data-wide={wide || undefined}>
      <header ref={fixed.header} className="shell__bar">
        {nav && <HistoryMenu view={title === "設定" ? "settings" : ""} homeUrl={home} onLeave={onLeave} />}
        {nav && back ? <Link href={back} className="shell__back" aria-label="ホーム" onClick={guard}><BackIcon /></Link>
          : !nav ? <span className="shell__brand">{APP_NAME}</span> : null}
        <div className="shell__title">
          {eyebrow && <p className="shell__eyebrow">{eyebrow}</p>}
          <h1 className="shell__name">{title}</h1>
        </div>
        {steps && <div className="shell__steps">{steps}</div>}
        {status ? <span className="sr-only" data-testid="phase">{status}</span> : null}
        {actions && <div className="shell__actions">{actions}</div>}
      </header>
      {steps && <div className="shell__steps-mobile">{steps}</div>}
      <main className="shell__panel">{children}</main>
    </div>
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

function BackIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="m7.8 13 5.6 5.6L12 20l-8-8 8-8 1.4 1.4L7.8 11H20v2H7.8Z" />
    </svg>
  );
}
