"use client";
import { useCallback, useEffect, useState } from "react";
import { authorizeWorkspace, pickDriveFile, preparePicker, SCOPES, workspaceRequest, type MaterialFile } from "@/lib/workspace";
import styles from "./workspace.module.css";
export function MaterialManager({ roomId, ended = false, onPickStart, onPickEnd }: { roomId: string; ended?: boolean; onPickStart?: () => void; onPickEnd?: () => void }) {
  const [files, setFiles] = useState<MaterialFile[]>([]), [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const refresh = useCallback(async () => { const data = await workspaceRequest<{ files: MaterialFile[] }>(`/rooms/${roomId}/materials`); setFiles(data.files); }, [roomId]);
  useEffect(() => { const controller = new AbortController(); void workspaceRequest<{ files: MaterialFile[] }>(`/rooms/${roomId}/materials`, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setFiles(data.files); }).catch(() => { if (!controller.signal.aborted) setError("共有資料を読み込めませんでした。画面を開き直してください。"); }); return () => controller.abort(); }, [roomId]);
  async function add() {
    if (!consent || busy) return; setBusy(true); setError(""); onPickStart?.();
    try { const token = await authorizeWorkspace(SCOPES.drive); const picked = await pickDriveFile(token); if (!picked) return;
      await workspaceRequest(`/rooms/${roomId}/materials`, { token, body: { fileId: picked.id, shareCopy: true } }); await refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); onPickEnd?.(); }
  }
  async function remove(id: string) {
    setBusy(true); setError(""); try { await workspaceRequest(`/rooms/${roomId}/materials/${id}/remove`, { body: {} }); await refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className={styles.manager} aria-label="共有資料の管理"><h2>共有資料</h2>
    {!!files.length && <ul>{files.map(f => <li key={f.id}><span>{f.name}</span><button type="button" className={styles.secondary} disabled={busy} onClick={() => void remove(f.id)} aria-label={`${f.name}の共有を解除`}>解除</button></li>)}</ul>}
    {!ended && <><label><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />選んだ資料のPDFの写しを、このセッションの参加者へ共有する</label><button type="button" className={styles.primary} disabled={busy || !consent || files.length >= 5} onPointerEnter={() => void preparePicker().catch(() => {})} onClick={() => void add()}>{busy ? "処理しています…" : "ドライブから追加"}</button><p className={styles.note}>PDF・Docs・Slides・Sheetsに対応。1件4MB、5件・合計8MBまで。元のDrive共有設定は変更しません。</p></>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </section>;
}
