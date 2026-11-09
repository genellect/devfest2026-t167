"use client";
import { useEffect } from "react";
import { useClassroom, syncLabel, classroomMock } from "./use-classroom";
import styles from "./classroom.module.css";
export function ClassroomSelector({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const connection = useClassroom();
  const courses = connection.courses?.filter(c => c.role === "teacher");
  useEffect(() => { if (courses && value && !courses.some(c => c.id === value)) onChange(""); }, [courses, value, onChange]);
  return <section className={styles.card} aria-label="Classroomのクラス選択">
    <h2>Classroom（任意）</h2>{classroomMock && <span className={styles.mock}>Classroom モック</span>}
    {!courses ? <button className={styles.secondary} type="button" disabled={connection.busy} onClick={() => void connection.connect()}>{connection.busy ? "接続しています…" : "Classroomからクラスを選ぶ"}</button> : <>
      <label htmlFor="host-classroom">クラス</label><select id="host-classroom" value={value} onChange={e => onChange(e.target.value)}><option value="">Classroomを使わずに作成</option>{courses.map(c => <option key={c.id} value={c.id}>{c.name}{c.section ? `・${c.section}` : ""}</option>)}</select>
      {!courses.length && <p className={styles.note}>このアカウントが教員として所属する有効なクラスがありません。</p>}
      <p className={styles.note}>{syncLabel(connection.syncedAt)}</p><button type="button" className={styles.secondary} disabled={connection.busy} onClick={() => void connection.connect()}>クラス情報を更新</button>
    </>}
    {connection.error && <p role="alert" className={styles.error}>{connection.error}</p>}
  </section>;
}
