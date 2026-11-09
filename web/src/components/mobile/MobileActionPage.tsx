"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import styles from "./mobile-action-page.module.css";

/** 参加・作成画面をホームの上に下から開く。URLと通常の戻る操作は維持する。 */
export function MobileActionPage({ title, children }: { title: string; children: React.ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const router = useRouter();
  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus({ preventScroll: true });
    return () => { document.body.style.overflow = overflow; };
  }, []);

  async function close() {
    if (closing.current) return;
    closing.current = true;
    if (panel.current && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      await panel.current.animate([{ transform: "translateY(0)" }, { transform: "translateY(100%)" }], {
        duration: 220, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards",
      }).finished.catch(() => {});
    }
    router.push("/home");
  }

  return <div ref={panel} className={styles.panel} role="region" aria-label={title} tabIndex={-1}
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); void close(); } }}
    onClickCapture={event => {
      const link = (event.target as Element).closest("a");
      if (link?.getAttribute("href") !== "/home" || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault(); event.stopPropagation(); void close();
    }}>
    {children}
  </div>;
}
