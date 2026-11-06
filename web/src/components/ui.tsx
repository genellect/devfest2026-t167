"use client";
import { useEffect, useState } from "react";

/** 画面上部の白い帯。eyebrow は小さい補足（クラス名など）、title は画面の見出し、nav はタブメニュー（components/nav.tsx） */
export function Header({ eyebrow, title, demo, nav, children }: {
  eyebrow?: string; title: string; demo?: boolean; nav?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <header className="header">
      <div className="header__title">
        {eyebrow && <p className="header__eyebrow">{eyebrow}</p>}
        <h1 className="header__name">{title}</h1>
      </div>
      <div className="header__actions">
        {demo && <Tag tone="yellow">デモデータ</Tag>}
        {children}
      </div>
      {nav}
    </header>
  );
}

export function Tag({ tone, children }: { tone?: "yellow" | "tint" | "blue"; children: React.ReactNode }) {
  return <span className={`tag${tone ? ` tag--${tone}` : ""}`}>{children}</span>;
}

/** AI の結果に付ける出典のタグ。モックのときはデモデータと示す */
export function SourceTag({ source }: { source?: string }) {
  return <Tag>{source === "mock" ? "デモデータ" : "Gemini による推定"}</Tag>;
}

const PHASES = [
  ["collecting", "事前意見"],
  ["discussing", "議論"],
  ["consensus", "合意"],
  ["closed", "結果"],
] as const;
export type Phase = (typeof PHASES)[number][0];
export const PHASE_LABEL: Record<Phase, string> = {
  collecting: "事前意見の受付中", discussing: "議論中", consensus: "合意の確認中", closed: "終了",
};

/** 部屋がいまどの段階かを示す */
export function PhaseSteps({ phase }: { phase: Phase }) {
  const cur = PHASES.findIndex(([p]) => p === phase);
  return (
    <ol className="steps" aria-label="議論の段階">
      {PHASES.map(([p, label], i) => (
        <li key={p} aria-current={i === cur ? "step" : undefined} data-done={i < cur}>{label}</li>
      ))}
      <li className="sr-only" data-testid="phase">{PHASE_LABEL[phase]}</li>
    </ol>
  );
}

/** /api/health から Gemini の接続種別を取る。モックならデモデータの表示を出す */
export function useGeminiSource() {
  const [source, setSource] = useState<string>();
  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then((d) => setSource(d.gemini)).catch(() => {});
  }, []);
  return source;
}

export function Loading({ label = "読み込み中…" }: { label?: string }) {
  return <main className="loading" aria-busy="true">{label}</main>;
}

export function ErrorScreen({ message, action }: { message: string; action?: React.ReactNode }) {
  return (
    <main className="screen">
      <div className="body body--center">
        <div className="box box--lg card card--narrow" role="alert">
          <h2 className="card__title">この画面を表示できません</h2>
          <p className="t-label">{message}</p>
          {action}
        </div>
      </div>
    </main>
  );
}
