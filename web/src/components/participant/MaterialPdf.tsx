"use client";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from "pdfjs-dist";
interface MaterialFile { id: string; name: string }
import { authenticatedFetch } from "@/lib/session";
import styles from "./participant-session.module.css";

export function MaterialPdf({ roomId, file }: { roomId: string; file: MaterialFile }) {
  const [document, setDocument] = useState<PDFDocumentProxy>(), [page, setPage] = useState(1);
  const [url, setUrl] = useState(""), [error, setError] = useState("");
  useEffect(() => {
    let active = true, objectUrl = "", task: PDFDocumentLoadingTask | undefined;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 45000);
    setUrl(""); setError(""); setDocument(undefined); setPage(1);
    void (async () => {
      try {
        const response = await authenticatedFetch(`/rooms/${roomId}/materials/${file.id}/content`, { signal: controller.signal });
        if (!response.ok) { const data = await response.json().catch(() => null); throw new Error(data?.error?.message ?? "資料を取得できませんでした"); }
        const blob = await response.blob(); if (!active) return;
        // 圧縮版はNextの開発用WebpackとPDF.js内部のexport変数名の衝突を避ける。
        const pdf = await import("pdfjs-dist/build/pdf.min.mjs"); if (!active) return;
        const assets = `/pdfjs-${pdf.version}/`; pdf.GlobalWorkerOptions.workerSrc = `${assets}pdf.worker.min.mjs`;
        task = pdf.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false, verbosity: 0, cMapUrl: `${assets}cmaps/`, cMapPacked: true, standardFontDataUrl: `${assets}standard_fonts/`, wasmUrl: `${assets}wasm/` });
        const loaded = await task.promise; if (!active) return;
        objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); setDocument(loaded);
      } catch { if (active) setError("資料を表示できませんでした。閉じて、もう一度開いてください。"); }
      finally { clearTimeout(timer); }
    })();
    return () => { active = false; controller.abort(); clearTimeout(timer); if (objectUrl) URL.revokeObjectURL(objectUrl); void task?.destroy().catch(() => {}); };
  }, [roomId, file.id]);
  if (error) return <p role="alert">{error}</p>;
  if (!document) return <p role="status">資料を読み込んでいます…</p>;
  return <div className={styles.pdfContainer}>
    <PdfPage document={document} page={page} name={file.name} />
    <div className={styles.pdfControls}><button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>前のページ</button><span aria-live="polite">{page} / {document.numPages}</span><button type="button" disabled={page >= document.numPages} onClick={() => setPage(p => p + 1)}>次のページ</button><a href={url} target="_blank" rel="noopener noreferrer">PDFを別タブで開く</a></div>
  </div>;
}
function PdfPage({ document, page, name }: { document: PDFDocumentProxy; page: number; name: string }) {
  const container = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0), [renderedKey, setRenderedKey] = useState(""), [text, setText] = useState(""), [error, setError] = useState("");
  const renderKey = `${page}:${width}`, rendered = renderedKey === renderKey;
  useEffect(() => { const el = container.current; if (!el) return; const observer = new ResizeObserver(() => setWidth(Math.max(1, el.clientWidth - 24))); observer.observe(el); return () => observer.disconnect(); }, []);
  useEffect(() => {
    if (!width || !canvas.current) return;
    let active = true, render: RenderTask | undefined; setRenderedKey(""); setText(""); setError(""); container.current?.scrollTo(0, 0);
    void (async () => {
      try {
        const source = await document.getPage(page); if (!active || !canvas.current) return;
        const base = source.getViewport({ scale: 1 });
        const scale = Math.min(width / base.width, 2), dpr = Math.min(window.devicePixelRatio || 1, 2);
        const pixels = base.width * base.height * scale * scale * dpr * dpr;
        const density = dpr * Math.min(1, Math.sqrt(4_000_000 / pixels));
        const viewport = source.getViewport({ scale: scale * density }), el = canvas.current;
        el.width = Math.ceil(viewport.width); el.height = Math.ceil(viewport.height); el.style.width = `${viewport.width / density}px`; el.style.height = `${viewport.height / density}px`;
        render = source.render({ canvas: el, viewport }); await render.promise;
        if (!active) return; setRenderedKey(`${page}:${width}`);
        const content = await source.getTextContent();
        if (active) setText(content.items.map(item => "str" in item ? item.str : "").join(" ").slice(0, 20000));
      } catch { if (active) setError("このページを表示できませんでした。PDFを別タブで開いて確認できます。"); }
    })();
    return () => { active = false; render?.cancel(); };
  }, [document, page, width]);
  return <div className={styles.pdfPages} ref={container}>
    {error ? <p role="alert">{error}</p> : <>{!rendered && <p role="status">ページを描画しています…</p>}<canvas ref={canvas} role="img" aria-label={`${name} ${page}ページ`} data-rendered={rendered || undefined} style={{ visibility: rendered ? "visible" : "hidden" }} /><p className={styles.pdfText}>{text}</p></>}
  </div>;
}
