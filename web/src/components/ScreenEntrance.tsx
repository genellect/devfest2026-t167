"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLayoutEffect, useRef, type ComponentProps, type ReactNode } from "react";
import styles from "./screen-entrance.module.css";

let finishNavigation: (() => void) | undefined;
function completeNavigation() { finishNavigation?.(); }

export function beginScreenTransition(navigate: () => void, direction: "up" | "down") {
  if (!document.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  if (finishNavigation) return true;
  const attribute = direction === "up" ? "risingScreen" : "fallingScreen";
  document.documentElement.dataset[attribute] = "true";
  const ready = new Promise<void>(resolve => {
    const timeout = setTimeout(completeNavigation, 3000);
    finishNavigation = () => { clearTimeout(timeout); finishNavigation = undefined; resolve(); };
  });
  try {
    const transition = document.startViewTransition(() => { navigate(); return ready; });
    void transition.finished.catch(() => { /* 省略時も遷移を維持する。 */ }).finally(() => {
      completeNavigation(); delete document.documentElement.dataset[attribute];
    });
  } catch {
    completeNavigation(); delete document.documentElement.dataset[attribute]; navigate();
  }
  return true;
}

export function useScreenDestination(ready = true) {
  useLayoutEffect(() => { if (ready) completeNavigation(); }, [ready]);
}

/** 遷移先のDOMが準備できてから、ホームの上に新しい画面を下から重ねる。 */
export function RisingScreenLink({ href, children, onClick, ...props }: ComponentProps<typeof Link>) {
  const router = useRouter();
  return <Link {...props} href={href} onClick={event => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || typeof href !== "string") return;
    if (beginScreenTransition(() => router.push(href), "up")) event.preventDefault();
  }}>{children}</Link>;
}

export function ScreenEntrance({ children }: { children: ReactNode }) {
  const screen = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // View Transition終了後もCSSの代替アニメーションを再開させない。
    if (document.documentElement.dataset.risingScreen) screen.current?.setAttribute("data-native-entry", "true");
    completeNavigation();
  }, []);
  return <div ref={screen} className={styles.screen} data-screen-entrance>{children}</div>;
}
