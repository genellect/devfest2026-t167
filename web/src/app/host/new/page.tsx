"use client";
import Link from "next/link";
import { Loading } from "@/components/ui";
import { useHostUser } from "@/lib/hostAuth";
import { HostPreparation } from "@/components/host/HostPreparation";

/** Googleログインと有効なアプリセッションを持つ本人が議論を作る。 */
export default function NewRoom() {
  const user = useHostUser();
  if (user === undefined) return <Loading />;
  if (user === null) return (
    <main className="screen"><div className="body body--center">
      <div className="box box--lg card card--narrow"><p className="t-label">議論を作るには、Googleでログインしてください。</p>
        <Link className="btn btn--yellow" href="/">ログインする</Link></div>
    </div></main>
  );
  return <HostPreparation />;
}
