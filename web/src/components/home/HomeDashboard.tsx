"use client";

import { ClassroomHome } from "@/components/classroom/ClassroomHome";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { JoinForm } from "@/components/JoinForm";
import { RisingScreenLink, useScreenDestination } from "@/components/ScreenEntrance";
import { Loading } from "@/components/ui";
import { useHostUser } from "@/lib/hostAuth";
import { clearJoinCode, normalizeJoinCode, pendingJoinCode } from "@/lib/join-code";
import HistoryMenu from "../history/HistoryMenu";
import { ThemeAssistant } from "./ThemeAssistant";
import styles from "./home.module.css";

export function HomeDashboard() {
  const user = useHostUser();
  const params = useSearchParams(), pathname = usePathname(), router = useRouter();
  const incomingCode = params.get("code"), requestedJoin = params.get("join") === "1";
  const openedRequest = useRef<string | undefined>(undefined);
  const [joinOpen, setJoinOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const joinTrigger = useRef<HTMLButtonElement>(null);
  const hostEntry = "/host/new";
  const uid = user?.uid;
  useScreenDestination(!!user);
  useEffect(() => {
    if (!uid) return;
    const code = normalizeJoinCode(incomingCode ?? pendingJoinCode());
    const request = code.length === 6 ? code : requestedJoin ? "manual" : "";
    if (request && openedRequest.current !== request) { openedRequest.current = request; setJoinOpen(true); }
  }, [uid, incomingCode, requestedJoin]);
  function closeJoin() {
    setJoinOpen(false); clearJoinCode(); openedRequest.current = undefined;
    if (incomingCode !== null || requestedJoin) router.replace(pathname);
  }
  useEffect(() => {
    const element = dialog.current;
    if (joinOpen && element && !element.open) { element.showModal(); element.querySelector("input")?.focus(); }
    else if (!joinOpen && element?.open) element.close();
  }, [joinOpen]);
  if (!user) return <Loading />;

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <HistoryMenu view="home" homeUrl="/home" />
        <ThemeAssistant key={uid} hostEntry={hostEntry} />
      </header>
      <main className={styles.canvas}>
        <h1 className={styles.srOnly}>あなたのホーム</h1>
        <section className={styles.actionCards} aria-label="議論の開始">
          <button ref={joinTrigger} className={styles.joinHero} aria-label="参加する" onClick={() => setJoinOpen(true)}>
            <span className={styles.actionTitle}><Icon name="add" />参加する</span>
          </button>
          <RisingScreenLink className={styles.hostHero} href={hostEntry} aria-label="ホストする"><span className={styles.actionTitle}><Icon name="add" />ホストする</span></RisingScreenLink>
        </section>
        <ClassroomHome key={user.uid} />
      </main>
      <dialog ref={dialog} className={styles.joinDialog} aria-label="議論に参加する" onClose={() => { closeJoin(); joinTrigger.current?.focus({ preventScroll: true }); }} onCancel={closeJoin} onClick={(e) => { if (e.target === e.currentTarget) closeJoin(); }}>
        {joinOpen && <><button className={styles.closeDialog} aria-label="参加画面を閉じる" onClick={closeJoin}><Icon name="close" /></button><Suspense><JoinForm key={incomingCode ?? "manual"} autoJoin /></Suspense></>}
      </dialog>
    </div>
  );
}

type IconName = "add" | "home" | "clock" | "star" | "target" | "settings" | "search" | "filter" | "class" | "list" | "grid" | "chat" | "arrow" | "menu" | "person" | "close";
function Icon({ name, filled = false }: { name: IconName; filled?: boolean }) {
  const paths: Record<IconName, React.ReactNode> = {
    add: <path d="M12 5v14M5 12h14" />, home: <><path d="m3 10 9-7 9 7v10H3Z" /><path d="M9 20v-7h6v7" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>, star: <path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3-5.7-3-5.7 3 1.1-6.3-4.6-4.5 6.4-.9Z" />,
    target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
    settings: <><path d="m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3Z" /><circle cx="12" cy="12" r="3" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>, filter: <><path d="M4 6h16M7 12h10M10 18h4" /></>,
    class: <><rect x="3" y="5" width="18" height="15" rx="2" /><path d="M3 10h18M8 3v4m8-4v4" /></>, list: <><path d="M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1" /></>,
    grid: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
    chat: <><path d="M4 4h16v13H9l-5 4Z" /><path d="M8 9h8M8 13h5" /></>, arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />, person: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>, close: <path d="m6 6 12 12M6 18 18 6" />,
  };
  return <svg viewBox="0 0 24 24" width="24" height="24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}
