"use client";

import { useEffect, useRef } from "react";
import { LP_HTML } from "./lpMarkup";
import { initLp } from "./lpMotion";

/** LP の本文を描き、スクロールの演出を付ける。本文は静的な HTML（lpMarkup.ts）で、利用者の入力を含まない */
export function ToposLp() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    return initLp(ref.current);
  }, []);
  return <div ref={ref} className="tlp" dangerouslySetInnerHTML={{ __html: LP_HTML }} />;
}
