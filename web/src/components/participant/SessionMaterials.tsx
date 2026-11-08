"use client";
import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { MaterialPdf } from "./MaterialPdf";
import { authenticatedFetch } from "@/lib/session";
import styles from "./participant-session.module.css";
interface Material { id: string; name: string }

/** 資料を開いても親のマイク・録音・経過時間はマウントしたままにする。 */
export function SessionMaterials({ roomId, elapsed }: { roomId: string; elapsed: string }) {
  const [files, setFiles] = useState<Material[]>([]), [error, setError] = useState("");
  const [open, setOpen] = useState(false), [selected, setSelected] = useState<Material>();
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const gesture = useRef<{ y: number; direction: "up" | "down" } | null>(null);
  const dragged = useRef(false);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await authenticatedFetch(`/rooms/${roomId}/materials`, { signal });
      const body = await response.json();
      if (!response.ok) throw new Error("unavailable");
      if (!signal?.aborted) { setFiles(body.files); setError(""); }
    } catch { if (!signal?.aborted) { setFiles([]); setError("共有資料を読み込めませんでした。もう一度お試しください。"); } }
  }, [roomId]);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => { if (!document.hidden) void load(controller.signal); };
    refresh(); const timer = setInterval(refresh, 15000);
    document.addEventListener("visibilitychange", refresh);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [load]);
  useEffect(() => {
    if (!open || !dialog.current) return;
    dialog.current.showModal(); heading.current?.focus();
    const previous = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);
  useEffect(() => { heading.current?.focus(); }, [selected]);
  useEffect(() => { if (selected && !files.some(f => f.id === selected.id)) { setSelected(undefined); } }, [files, selected]);
  function close() {
    if (closing) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { dialog.current?.close(); return; }
    setClosing(true); closeTimer.current = setTimeout(() => dialog.current?.close(), 400);
  }
  function down(event: PointerEvent<HTMLElement>, direction: "up" | "down") {
    if (event.button !== 0 || (direction === "down" && (event.target as HTMLElement).closest("button"))) return;
    gesture.current = { y: event.clientY, direction }; dragged.current = false; event.currentTarget.setPointerCapture(event.pointerId);
  }
  function up(event: PointerEvent<HTMLElement>) {
    const start = gesture.current; gesture.current = null; if (!start) return;
    const distance = event.clientY - start.y; dragged.current = Math.abs(distance) > 12;
    if (start.direction === "up" && distance < -40) { setClosing(false); setSelected(undefined); setOpen(true); }
    if (start.direction === "down" && distance > 50) close();
  }
  return <>
    <button ref={trigger} className={styles.materialsPeek} aria-haspopup="dialog" aria-expanded={open} onPointerDown={e => down(e,"up")} onPointerUp={up} onPointerCancel={() => { gesture.current = null; }} onClick={e => { const ignore = dragged.current && e.detail !== 0; dragged.current = false; if (!ignore) { setClosing(false); setSelected(undefined); setOpen(true); } }}>
      <span className={styles.handle} aria-hidden="true" /><span>▱ 共有資料 <small>{files.length}件</small></span><span aria-hidden="true">⌃</span>
    </button>
    <dialog ref={dialog} className={styles.materialsSheet} data-viewer={!!selected || undefined} data-closing={closing || undefined} aria-labelledby="session-materials-heading"
      onCancel={e => { e.preventDefault(); if (selected) { setSelected(undefined); } else close(); }}
      onClose={() => { clearTimeout(closeTimer.current); setClosing(false); setOpen(false); setSelected(undefined); trigger.current?.focus(); }}
      onClick={e => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if(e.clientY < r.top || e.clientY > r.bottom) close(); } }}>
      <header className={styles.materialsHeader} onPointerDown={e => down(e,"down")} onPointerUp={up} onPointerCancel={() => { gesture.current = null; }}>
        {selected && <button onClick={() => { setSelected(undefined); }} aria-label="資料一覧へ戻る">‹</button>}
        <h2 id="session-materials-heading" ref={heading} tabIndex={-1}>{selected?.name || "共有資料"}</h2>
        <button onClick={close} aria-label="資料を閉じて議論へ戻る">⌄</button>
      </header>
      {selected ? <MaterialPdf roomId={roomId} file={selected} /> : <div className={styles.materialsList}>
        <p>共有資料を開いている間も、話し合いと録音は続きます。</p>
        {error ? <><p role="alert">{error}</p><button className="btn" onClick={() => void load()}>再読み込み</button></>
          : files.length ? <ul>{files.map(file => <li key={file.id}><button onClick={() => setSelected(file)}><span aria-hidden="true">▤</span><span>{file.name}</span><span aria-hidden="true">›</span></button></li>)}</ul>
            : <p>共有資料はまだありません。</p>}
      </div>}
      <footer className={styles.materialsFooter}>話し合い中 <span>{elapsed}</span></footer>
    </dialog>
  </>;
}
