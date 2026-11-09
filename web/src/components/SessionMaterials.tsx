"use client";
import { useEffect, useRef, useState } from "react";
import { authorizeDrive, materialRequest, pickDriveFile, SCOPES, type MaterialFile } from "@/lib/drive";
import { useRoomFeed } from "@/lib/room-stream";
import { authenticatedFetch } from "@/lib/session";
const NO_FILES: MaterialFile[] = [];

export function SessionMaterials({ roomId, editable = false, ended = false }: { roomId: string; editable?: boolean; ended?: boolean }) {
  const files = (useRoomFeed(roomId).collections[`sessions/${roomId}/materials`] ?? NO_FILES) as unknown as MaterialFile[];
  const [pending, setPending] = useState<{ id: string; name: string }>();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [preview, setPreview] = useState<{ id: string; name: string; url: string }>();
  const confirm = useRef<HTMLDialogElement>(null), viewer = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (pending) confirm.current?.showModal(); }, [pending]);
  useEffect(() => { if (preview) viewer.current?.showModal(); return () => { if (preview) URL.revokeObjectURL(preview.url); }; }, [preview]);
  useEffect(() => { if (preview && !files.some(file => file.id === preview.id)) { viewer.current?.close(); setPreview(undefined); } }, [files, preview]);
  async function choose() {
    setBusy(true); setError("");
    try { const token = await authorizeDrive(SCOPES.drive); const file = await pickDriveFile(token); if (file) setPending(file); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function add() {
    if (!pending) return; setBusy(true); setError("");
    try { const token = await authorizeDrive(SCOPES.drive); await materialRequest(`/rooms/${roomId}/materials`, { token, body: { fileId: pending.id, shareCopy: true } }); confirm.current?.close(); setPending(undefined); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function open(file: MaterialFile) {
    setBusy(true); setError("");
    try { const res = await authenticatedFetch(`/rooms/${roomId}/materials/${file.id}/content`); if (!res.ok) { const data = await res.json(); throw new Error(data.error?.message || "資料を開けませんでした"); } setPreview({ id: file.id, name: file.name, url: URL.createObjectURL(await res.blob()) }); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function remove(file: MaterialFile) {
    setBusy(true); setError("");
    try { await materialRequest(`/rooms/${roomId}/materials/${file.id}/remove`, { body: {} }); if (preview?.id === file.id) { viewer.current?.close(); setPreview(undefined); } }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (!editable && !files.length) return null;
  return <section className="session-materials" aria-label="共有資料">
    <div className="heading-row"><h2 className="t-sm">資料</h2>{editable && !ended && <button className="btn btn--small" disabled={busy || files.length >= 5} onClick={() => void choose()}>{busy ? "処理しています…" : "Driveから追加"}</button>}</div>
    {files.length ? <ul>{files.map(file => <li key={file.id}><button className="text-btn" disabled={busy} onClick={() => void open(file)}>{file.name}</button>{editable && <button className="text-btn" disabled={busy} aria-label={`${file.name}の共有を解除`} onClick={() => void remove(file)}>解除</button>}</li>)}</ul> : <p className="t-note">議論に使う資料をDriveから選べます。</p>}
    {error && !pending && <p className="notice notice--error" role="alert">{error}</p>}
    <dialog ref={confirm} className="dialog" aria-labelledby="material-confirm-title" onCancel={e => { if (busy) e.preventDefault(); else setPending(undefined); }}>
      <div className="dialog__head"><h2 id="material-confirm-title" className="t-md">資料を追加</h2><button className="btn btn--small" disabled={busy} onClick={() => { confirm.current?.close(); setPending(undefined); }}>閉じる</button></div>
      <div className="pad stack"><p className="t-sm">{pending?.name}</p><p className="t-note">PDFの写しを参加者に共有します。元のDriveの共有設定は変わりません。</p><p className="t-small">PDF・Google Docs・Slides・Sheetsに対応。1件4MB、5件・合計8MBまで。</p>{error && <p className="notice notice--error" role="alert">{error}</p>}<button className="btn btn--blue" disabled={busy || !pending} onClick={() => void add()}>{busy ? "追加しています…" : "参加者に共有する"}</button></div>
    </dialog>
    <dialog ref={viewer} className="dialog session-material-viewer" aria-labelledby="material-viewer-title" onClose={() => setPreview(undefined)}>
      <div className="dialog__head"><h2 id="material-viewer-title" className="t-sm">{preview?.name}</h2><button className="btn btn--small" onClick={() => { viewer.current?.close(); setPreview(undefined); }}>閉じる</button></div>
      {preview && <><iframe src={preview.url} title={preview.name} /><p className="pad"><a className="btn" href={preview.url} download={`${preview.name}.pdf`}>PDFをダウンロード</a></p></>}
    </dialog>
  </section>;
}
