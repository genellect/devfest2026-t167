"use client";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ComponentProps, MouseEvent } from "react";
import { AppShell } from "@/components/shell";
import { useGeminiSource } from "@/components/ui";

/** セッション専用の枠。ログイン・ホームで使う共通AppShellの変更と独立させる。 */
export function SessionShell(props: ComponentProps<typeof AppShell> & { back: string; hero?: boolean; hideBack?: boolean }) {
  const demo = useGeminiSource() === "mock";
  const guard = (e: MouseEvent) => { if (props.onLeave && !props.onLeave()) e.preventDefault(); };
  return <div className="session-workspace" data-active={props.hideBack || undefined}>
    {!props.hideBack && <Link href={props.back} className="session-back" aria-label="ホーム" onClick={guard}><ArrowLeft size={24} strokeWidth={1.75} aria-hidden="true" /></Link>}
    <main className="session-page" data-wide={props.wide || undefined}>
      {!props.hero && <h1 className="session-page__title">{props.title}</h1>}
      {(props.actions || demo) && <div className="session-actions">{demo && <span className="tag tag--yellow">デモデータ</span>}{props.actions}</div>}
      {props.status && <span className="sr-only" data-testid="phase">{props.status}</span>}
      {props.children}
    </main>
  </div>;
}
