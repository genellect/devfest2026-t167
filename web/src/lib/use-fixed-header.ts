"use client";
import { useLayoutEffect, useState } from "react";

/** 固定バーの実寸だけ本文を下げる。文字拡大・改行・端末の回転にも追従する。 */
export function useFixedHeader() {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [header, setHeader] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!root || !header) return;
    const measure = () => root.style.setProperty("--fixed-header-height", `${Math.ceil(header.getBoundingClientRect().height)}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [root, header]);
  return { root: setRoot, header: setHeader };
}
