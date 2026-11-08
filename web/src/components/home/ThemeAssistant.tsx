"use client";

import { useEffect, useId, useRef, useState } from "react";
import { RisingScreenLink } from "@/components/ScreenEntrance";
import { authenticatedFetch } from "@/lib/session";
import styles from "./theme-assistant.module.css";

interface Suggestions { themes: string[]; source: "gemini" | "mock" }

export function GeminiMark() {
  const id = useId();
  return <svg viewBox="0 0 24 24" width="26" height="26" role="img" aria-label="Gemini">
    <defs><linearGradient id={id} x1="0" y1="1" x2="1" y2="0"><stop stopColor="#4285f4" /><stop offset=".48" stopColor="#8865e9" /><stop offset="1" stopColor="#d96570" /></linearGradient></defs>
    <path fill={`url(#${id})`} d="M12 1C10.7 7.8 7.8 10.7 1 12c6.8 1.3 9.7 4.2 11 11 1.3-6.8 4.2-9.7 11-11C16.2 10.7 13.3 7.8 12 1Z" />
  </svg>;
}

export function ThemeAssistant({ hostEntry }: { hostEntry: string }) {
  const [open, setOpen] = useState(false), [closing, setClosing] = useState(false), [request, setRequest] = useState("");
  const [reply, setReply] = useState<Suggestions>(), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const controller = useRef<AbortController | null>(null), pending = useRef(false);
  const titleId = useId(), inputId = useId();
  const originClip = useRef("inset(0px 0px 0px 0px round 28px)");
  useEffect(() => {
    const element = dialog.current;
    if (!open || !element) return;
    if (!element.open) {
      element.showModal();
      element.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const current = getComputedStyle(element).clipPath;
    const animation = reduced ? undefined : element.animate([
      { clipPath: closing ? (current === "none" ? "inset(0px 0px 0px 0px round 0px)" : current) : originClip.current },
      { clipPath: closing ? originClip.current : "inset(0px 0px 0px 0px round 0px)" },
    ], { duration: 400, easing: "cubic-bezier(.2,0,0,1)", fill: "both" });
    const finish = () => {
      element.close(); setOpen(false); setClosing(false);
    };
    let fallback: ReturnType<typeof setTimeout> | undefined;
    if (closing) {
      if (animation) {
        void animation.finished.then(finish, () => {});
        fallback = setTimeout(finish, 480);
      } else finish();
    }
    return () => { clearTimeout(fallback); animation?.cancel(); };
  }, [open, closing]);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // iOSのソフトキーボード表示中も入力欄を可視領域内に保つ。
    const viewport = window.visualViewport;
    const updateViewport = () => {
      dialog.current?.style.setProperty("--viewport-height", `${viewport?.height ?? window.innerHeight}px`);
      dialog.current?.style.setProperty("--viewport-top", `${viewport?.offsetTop ?? 0}px`);
    };
    updateViewport();
    viewport?.addEventListener("resize", updateViewport);
    viewport?.addEventListener("scroll", updateViewport);
    return () => {
      document.body.style.overflow = previous;
      viewport?.removeEventListener("resize", updateViewport);
      viewport?.removeEventListener("scroll", updateViewport);
    };
  }, [open]);
  useEffect(() => () => controller.current?.abort(), []);
  function openAssistant() {
    const box = trigger.current?.getBoundingClientRect();
    if (box) originClip.current = `inset(${box.top}px ${Math.max(0, window.innerWidth - box.right)}px ${Math.max(0, window.innerHeight - box.bottom)}px ${box.left}px round 28px)`;
    setClosing(false); setOpen(true);
  }
  function stopRequest() { controller.current?.abort(); controller.current = null; pending.current = false; setBusy(false); }
  function close() { stopRequest(); setClosing(true); }
  function closeForNavigation() { stopRequest(); dialog.current?.close(); setOpen(false); setClosing(false); }
  async function suggest(another = false) {
    if (!request.trim() || pending.current) return;
    const active = new AbortController();
    controller.current = active; pending.current = true; setBusy(true); setError("");
    const timer = setTimeout(() => active.abort(), 30_000);
    try {
      const response = await authenticatedFetch("/themes/suggest", {
        method: "POST", headers: { "content-type": "application/json" }, signal: active.signal,
        body: JSON.stringify({ request: request.trim(), previous: another ? reply?.themes ?? [] : [] }),
      });
      if (controller.current !== active) return;
      if (!response.ok) throw new Error(response.status === 429 ? "少し待ってから、もう一度お試しください。" : "テーマを提案できませんでした。もう一度お試しください。");
      const value = await response.json() as Suggestions;
      if (!Array.isArray(value.themes) || value.themes.length !== 3 || value.themes.some(t => typeof t !== "string" || !t.trim() || t.length > 100) || !["gemini", "mock"].includes(value.source)) throw new Error("候補を取得できませんでした。もう一度お試しください。");
      if (controller.current === active) setReply(value);
    } catch (e) {
      if (controller.current === active) setError(active.signal.aborted ? "時間がかかっています。もう一度お試しください。" : e instanceof Error ? e.message : "接続を確認して、もう一度お試しください。");
    } finally {
      clearTimeout(timer);
      if (controller.current === active) { controller.current = null; pending.current = false; setBusy(false); }
    }
  }
  return <>
    <button ref={trigger} type="button" className={styles.trigger} aria-haspopup="dialog" aria-expanded={open} onClick={openAssistant}><GeminiMark /><span>話し合うテーマを考える</span></button>
    <dialog ref={dialog} className={styles.dialog} data-closing={closing || undefined} aria-labelledby={titleId} onCancel={e => { e.preventDefault(); close(); }} onClose={() => { stopRequest(); setOpen(false); setClosing(false); trigger.current?.focus({ preventScroll: true }); }} onClick={e => {
      if (e.target !== e.currentTarget) return;
      const box = e.currentTarget.getBoundingClientRect();
      if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) close();
    }}>
      <div className={styles.heading}><h2 id={titleId} tabIndex={-1}><GeminiMark />テーマを考える</h2><button type="button" className={styles.close} aria-label="テーマ相談を閉じる" onClick={close}>×</button></div>
      <div className={styles.content} aria-live="polite" aria-busy={busy}>
        {!reply && !busy && !error && <div className={styles.welcome}>
          <GeminiMark />
          <p className={styles.welcomeTitle}>話し合いのきっかけを、<br />一緒に。</p>
          <p className={styles.welcomeNote}>気になることから、テーマを見つけよう</p>
        </div>}
        {busy && <p className={styles.note} role="status">テーマを考えています…</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        {reply && <section aria-label="テーマの候補" className={styles.results}>
          <p className={styles.note}>{reply.source === "mock" ? "デモ候補" : "Geminiからの提案"}</p>
          <ol>{reply.themes.map((theme, index) => <li key={theme}><span className={styles.number}>{index + 1}</span><div><h3>{theme}</h3><RisingScreenLink href={`${hostEntry}?theme=${encodeURIComponent(theme)}`} className={styles.use} onClick={closeForNavigation}>このテーマで作成<span aria-hidden="true"> →</span></RisingScreenLink></div></li>)}</ol>
          <button type="button" className={styles.another} disabled={busy} onClick={() => void suggest(true)}>別の案を出す</button>
        </section>}
      </div>
      <form className={styles.inputDock} onSubmit={e => { e.preventDefault(); void suggest(); }}>
        <label htmlFor={inputId}>どんなことを話し合いたい？</label>
        <div className={styles.composer}>
          <textarea id={inputId} value={request} maxLength={500} rows={1} placeholder="テーマについて相談する" onChange={e => { setRequest(e.target.value); setReply(undefined); setError(""); }} disabled={busy} />
          <button className={styles.send} type="submit" disabled={busy || !request.trim()} aria-label="テーマを提案する"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg></button>
        </div>
      </form>
    </dialog>
  </>;
}
