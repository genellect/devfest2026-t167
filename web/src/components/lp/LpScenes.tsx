"use client";
import { useEffect } from "react";

/**
 * LP のスクロールの演出。
 * - data-scene：縦に長い節の中で画面を固定し、どこまで読み進めたか（0〜1）を CSS 変数 --p に入れる。
 *   変形と透明度は CSS が --p から計算する（transform と opacity だけを動かす）。
 * - data-reveal：画面に入ったら1回だけ is-in を付ける。
 * 動きを減らす設定では、--p を1（最後の状態）にして固定もしない（CSS 側）。
 */
export function LpScenes() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".lp");
    if (!root) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const scenes = [...root.querySelectorAll<HTMLElement>("[data-scene]")];
    let frame = 0;
    const update = () => {
      frame = 0;
      const vh = window.innerHeight;
      for (const el of scenes) {
        if (reduce.matches) { el.style.setProperty("--p", "1"); continue; }
        const r = el.getBoundingClientRect();
        const run = Math.max(1, r.height - vh);
        const p = Math.min(1, Math.max(0, -r.top / run));
        el.style.setProperty("--p", p.toFixed(4));
        el.classList.toggle("is-past", p > 0.2);
      }
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    reduce.addEventListener("change", onScroll);

    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
    }, { threshold: 0.2 });
    root.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));
    root.classList.add("lp--ready");
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      reduce.removeEventListener("change", onScroll);
      io.disconnect();
    };
  }, []);
  return null;
}
