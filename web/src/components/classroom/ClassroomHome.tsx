"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { authorizeWorkspace, SCOPES, workspaceRequest, workspaceToken } from "@/lib/workspace";
import { useClassroom, syncLabel, classroomMock } from "./use-classroom";
import styles from "./classroom.module.css";
interface Discussion { roomId: string; title: string; theme: string; phase: string; joined: boolean; host: boolean }
export function ClassroomHome() {
  const router = useRouter();
  const connection = useClassroom();
  const [selected, setSelected] = useState("");
  const course = connection.courses?.find(c => c.id === selected) ?? connection.courses?.[0];
  const id = course?.id;
  const [reload, setReload] = useState(0), [joining, setJoining] = useState(false);
  const [listing, setListing] = useState<{ id?: string; sessions?: Discussion[]; error?: string; syncedAt?: number }>({});
  const [roster, setRoster] = useState<{ id: string; students: { id: string; name: string }[] }>();
  const [rosterBusy, setRosterBusy] = useState(false), [operationError, setOperationError] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    const request = generation; const version = ++request.current; setListing({ id }); setRoster(undefined); setOperationError("");
    if (!id) return;
    const controller = new AbortController();
    void Promise.resolve().then(() => workspaceRequest<{ sessions: Discussion[]; syncedAt: number }>(`/integrations/classroom/courses/${encodeURIComponent(id)}/discussions`, { token: workspaceToken(), signal: controller.signal }))
      .then(data => { if (version === generation.current) setListing({ id, ...data }); })
      .catch(e => { if (version === generation.current) setListing({ id, error: (e as Error).message }); });
    return () => { request.current++; controller.abort(); };
  }, [id, reload, connection.syncedAt]);
  async function join(item: Discussion) {
    if (joining) return; setJoining(true); setOperationError(""); const version = generation.current;
    try {
      await workspaceRequest("/rooms/join", { token: workspaceToken(), body: { classroomRoomId: item.roomId } });
      if (version === generation.current) router.push(`/rooms/${encodeURIComponent(item.roomId)}`);
    } catch (e) { if (version === generation.current) setOperationError((e as Error).message); }
    finally { setJoining(false); }
  }
  async function showRoster() {
    if (!id || rosterBusy) return;
    const version = generation.current; setRosterBusy(true); setOperationError("");
    try { const token = await authorizeWorkspace(SCOPES.roster); const data = await workspaceRequest<{ students: { id: string; name: string }[] }>(`/integrations/classroom/courses/${encodeURIComponent(id)}/roster`, { token }); if (version === generation.current) setRoster({ id, students: data.students }); }
    catch (e) { if (version === generation.current) setOperationError((e as Error).message); }
    finally { setRosterBusy(false); }
  }
  const data = listing.id === id ? listing : {};
  return <section className={styles.card} aria-label="Classroomの話し合い">
    <h2>クラスの話し合い</h2>
    {classroomMock && <span className={styles.mock}>Classroom モック</span>}
    <p className={styles.note}>ログイン中と同じGoogleアカウントのクラスを表示します。コード・QRからも参加できます。</p>
    {connection.error && <p role="alert" className={styles.error}>{connection.error}</p>}
    {!connection.courses ? <button className={styles.secondary} disabled={connection.busy} onClick={() => void connection.connect()}>{connection.busy ? "接続しています…" : "Classroomと連携"}</button> : <>
      <div className={styles.actions}><button className={styles.secondary} disabled={connection.busy || joining} onClick={() => void connection.connect()}>クラス情報を更新</button><button className={styles.secondary} disabled={joining} onClick={() => { generation.current++; connection.disconnect(); setSelected(""); setRoster(undefined); }}>このタブの連携を終了</button></div>
      {!connection.courses.length ? <p role="status">所属している有効なクラスがありません。学校用のGoogleアカウントか確認してください。</p> : <>
        <label htmlFor="classroom-home-course">クラス</label>
        <select id="classroom-home-course" value={id ?? ""} disabled={joining} onChange={e => setSelected(e.target.value)}>{connection.courses.map(c => <option value={c.id} key={c.id}>{c.name}{c.section ? `・${c.section}` : ""}（{c.role === "teacher" ? "教員" : "生徒"}）</option>)}</select>
        {course?.role === "teacher" && <div className={styles.actions}><Link className={styles.primary} href={`/host/new?course=${encodeURIComponent(course.id)}`}>このクラスでホストする</Link><button className={styles.secondary} disabled={rosterBusy} onClick={() => void showRoster()}>{rosterBusy ? "名簿を取得中…" : "名簿を確認"}</button></div>}
        {roster && roster.id === id && <details open><summary>クラス名簿 {roster.students.length}人</summary><p className={styles.note}>参加状況は、作成した話し合いの待機画面で確認できます。</p><ul className={styles.list}>{roster.students.map(p => <li key={p.id}>{p.name}</li>)}</ul></details>}
        <div className={styles.actions}><button className={styles.secondary} disabled={joining} onClick={() => setReload(n => n + 1)}>話し合いを更新</button><span className={styles.note}>{syncLabel(data.syncedAt)}</span></div>
        {data.error && <p role="alert" className={styles.error}>{data.error}</p>}
        {!data.error && !data.sessions && <p role="status">話し合いを取得しています…</p>}
        {data.sessions?.length === 0 && <p role="status">現在参加できる話し合いはありません。</p>}
        {!!data.sessions?.length && <ul className={styles.list}>{data.sessions.map(s => <li key={s.roomId}><div className={styles.copy}><strong>{s.theme || s.title}</strong><small className={styles.note}>{s.phase === "collecting" ? "準備中" : "進行中"}</small></div>{s.host ? <Link className={styles.secondary} href={`/rooms/${encodeURIComponent(s.roomId)}`}>開く</Link> : <button className={styles.secondary} disabled={joining} onClick={() => void join(s)}>{s.joined ? "開く" : "参加する"}</button>}</li>)}</ul>}
      </>}
    </>}
    {operationError && <p role="alert" className={styles.error}>{operationError}</p>}
  </section>;
}
