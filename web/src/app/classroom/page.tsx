"use client";
import Link from "next/link";
import { ClassroomHome } from "@/components/classroom/ClassroomHome";
import { useHostUser } from "@/lib/hostAuth";
import { Loading } from "@/components/ui";
import styles from "@/components/classroom/classroom.module.css";
export default function ClassroomPage() {
  const user = useHostUser();
  if (!user) return <Loading />;
  return <main className={styles.page}><header><Link href={"/home"}>‹ ホーム</Link><h1>Classroom連携</h1></header><ClassroomHome key={user.uid} /></main>;
}
