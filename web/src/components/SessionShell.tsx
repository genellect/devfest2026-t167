"use client";
import Link from "next/link";
import { Home, Settings2 } from "lucide-react";
import type { ComponentProps, MouseEvent } from "react";
import { AppShell } from "@/components/shell";

/** セッション専用の枠。ログイン・ホームで使う共通AppShellの変更と独立させる。 */
export function SessionShell(props: ComponentProps<typeof AppShell> & { back: string }) {
  const guard = (e: MouseEvent) => { if (props.onLeave && !props.onLeave()) e.preventDefault(); };
  return <div className="session-workspace">
    <nav className="session-nav" aria-label="セッションのナビゲーション">
      <p className="session-nav__brand">Topos</p>
      <Link href={props.back} onClick={guard}><Home size={17} aria-hidden="true" />ホームに戻る</Link>
      <span className="session-nav__current" aria-current="page">セッション</span>
      <Link href="/host/profile" onClick={guard}><Settings2 size={17} aria-hidden="true" />アカウント設定</Link>
    </nav>
    <AppShell {...props} />
  </div>;
}
