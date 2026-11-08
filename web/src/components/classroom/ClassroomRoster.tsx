"use client";
import { useEffect, useRef, useState } from "react";
import { authorizeWorkspace, SCOPES, workspaceRequest } from "@/lib/workspace";
import { syncLabel, classroomMock } from "./use-classroom";
import styles from "./classroom.module.css";
interface Roster { students: { id: string; name: string; joined: boolean }[]; syncedAt: number; sharedDeviceNote: string }
export function ClassroomRoster({ roomId }: { roomId: string }) {
  const [data, setData] = useState<Roster>(), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const version = useRef(0);
  useEffect(() => () => { version.current++; }, [roomId]);
  async function refresh() {
    if (busy) return; setBusy(true); setError(""); const generation = version.current;
    try { const token = await authorizeWorkspace(SCOPES.roster); const r = await workspaceRequest<Roster>(`/rooms/${encodeURIComponent(roomId)}/classroom/roster`, { token }); if (generation === version.current) setData(r); }
    catch (e) { if (generation === version.current) { setData(undefined); setError((e as Error).message); } }
    finally { if (generation === version.current) setBusy(false); }
  }
  return <section className={styles.card} aria-label="クラスの参加状況"><h2>クラスの参加状況</h2>{classroomMock && <span className={styles.mock}>Classroom モック</span>}
    <div className={styles.actions}><button type="button" className={styles.secondary} disabled={busy} onClick={() => void refresh()}>{busy ? "確認しています…" : data ? "名簿・参加状況を更新" : "名簿・参加状況を確認"}</button><span className={styles.note}>{syncLabel(data?.syncedAt)}</span></div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {data && <><p>参加済み {data.students.filter(p => p.joined).length}／名簿 {data.students.length}人</p><ul className={styles.list}>{data.students.map(p => <li key={p.id}><span className={styles.copy}>{p.name}</span><span className={p.joined ? styles.badge : styles.note}>{p.joined ? "参加済み" : "未参加"}</span></li>)}</ul><p className={styles.note}>{data.sharedDeviceNote}</p></>}
  </section>;
}
