"use client";
import { APP_NAME } from "@/lib/brand";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Icon from "./HistoryIcon";
import home from "../home/home.module.css";
import styles from "./history.module.css";

/** ホーム・履歴・設定に共通の3項目メニュー。 */
export default function HistoryMenu({ view, homeUrl, onLeave }: { view: string; homeUrl: string; onLeave?: () => boolean }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const destination = useRef<string | undefined>(undefined);
  const [open, setOpen] = useState(false), [closing, setClosing] = useState(false);
  function close() { setClosing(true); setOpen(false); }
  function navigate(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
    if (onLeave && !onLeave()) { event.preventDefault(); return; }
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); destination.current = href; close();
  }
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open) {
      setClosing(false);
      if (!el.open) { el.showModal(); el.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true }); }
      return;
    }
    if (!el.open) return;
    let completed = false;
    const finish = () => {
      if (completed) return;
      completed = true; clearTimeout(timer); el.removeEventListener("animationend", ended);
      const href = destination.current; destination.current = undefined;
      el.close(); setClosing(false);
      if (href) router.push(href);
    };
    const ended = (event: AnimationEvent) => { if (event.target === el && !event.pseudoElement) finish(); };
    const timer = setTimeout(finish, 480);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { finish(); return; }
    el.addEventListener("animationend", ended);
    return () => { clearTimeout(timer); el.removeEventListener("animationend", ended); };
  }, [open, router]);
  useEffect(() => {
    if (!open && !closing) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open, closing]);
  const selected = view === "home" ? "home" : view === "settings" ? "settings" : view === "all" || view === "recent" ? "history" : "";
  return <>
    <button className={styles.iconButton} ref={trigger} aria-label="メニュー" aria-haspopup="dialog" aria-expanded={open} aria-controls="workspace-navigation" onClick={() => { destination.current = undefined; setOpen(true); }}><Icon name="menu" /></button>
    <dialog id="workspace-navigation" ref={dialog} className={home.drawer} data-closing={closing || undefined} aria-label="ホームのメニュー"
      onCancel={e => { e.preventDefault(); close(); }} onClick={e => { if (e.target === e.currentTarget) close(); }}
      onClose={() => { setOpen(false); setClosing(false); trigger.current?.focus({ preventScroll: true }); }}>
      <aside className={home.sidebar}>
        <h2 className={home.drawerTitle} tabIndex={-1}>{APP_NAME}</h2>
        <nav aria-label="ホームのメニュー">
          <Link href={homeUrl} className={selected === "home" ? home.selected : undefined} aria-current={selected === "home" ? "page" : undefined} onClick={e => navigate(e, homeUrl)}><Icon name="home" /><span>ホーム</span></Link>
          <Link href="/history" className={selected === "history" ? home.selected : undefined} aria-current={selected === "history" ? "page" : undefined} onClick={e => navigate(e, "/history")}><Icon name="clock" /><span>履歴</span></Link>
          <Link href="/settings" className={selected === "settings" ? home.selected : undefined} aria-current={selected === "settings" ? "page" : undefined} onClick={e => navigate(e, "/settings")}><Icon name="settings" /><span>設定</span></Link>
        </nav>
      </aside>
    </dialog>
  </>;
}
