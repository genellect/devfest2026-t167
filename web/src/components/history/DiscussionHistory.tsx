"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useHostUser } from "@/lib/hostAuth";
import { sessionRequest } from "@/lib/session";
import { getHistory, getRoomLabel } from "@/lib/local";
import { Loading } from "@/components/ui";
import Icon from "./HistoryIcon";
import HistoryMenu from "./HistoryMenu";
import styles from "./history.module.css";
import { useFixedHeader } from "@/lib/use-fixed-header";
interface Discussion { sessionId: string; theme?: string; title?: string; className?: string; role: "host" | "participant"; phase: string; ended?: boolean; groupId?: string | null }
function titleOf(item: Discussion) { return item.theme === "" ? "テーマ非公開" : item.theme || item.title || "議論"; }
function openedTimes() {
  const times: Record<string,number> = Object.create(null);
  for (const role of ["host","participant"] as const) {
    const entries = getHistory(role);
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) if (entry && typeof entry.roomId === "string" && Number.isFinite(entry.at)) times[entry.roomId] = Math.max(times[entry.roomId] ?? 0, entry.at);
  }
  return times;
}
function openedLabel(at?: number) {
  if (!at || !Number.isFinite(new Date(at).getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(at)+"に開きました";
}
export default function DiscussionHistory() {
  const fixed = useFixedHeader();
  const user = useHostUser(), params = useSearchParams();
  const uid = user?.uid;
  const requested = params.get("view"), view = requested === "recent" ? requested : "all";
  const [feed,setFeed] = useState<{uid:string;items?:Discussion[];error?:string}>();
  const [recent,setRecent] = useState<{uid:string;times:Record<string,number>}>();
  const [query,setQuery] = useState("");
  const [reload,setReload] = useState(0);
  useEffect(()=>{
    if (!uid) return;
    let active = true;
    setFeed({uid});
    sessionRequest<{sessions:Discussion[]}>("/discussions")
      .then(r=>{if(active)setFeed({uid,items:r.sessions});})
      .catch(()=>{if(active)setFeed({uid,error:"履歴を読み込めませんでした。接続を確認してください。"});});
    return ()=>{active=false;};
  },[uid,reload]);
  useEffect(()=>{
    if (!uid) return;
    const load=()=>{setRecent({uid,times:openedTimes()});};
    load(); setQuery("");
    window.addEventListener("storage",load);
    return ()=>window.removeEventListener("storage",load);
  },[uid]);
  useEffect(()=>{setQuery("");},[view]);
  if (!user) return <Loading/>;
  const data = feed?.uid===uid ? feed : undefined;
  const times = recent && recent.uid===uid ? recent.times : {};
  const source = data?.items;
  const rows = source?.filter(item=>(view!=="recent" || times[item.sessionId]) && `${titleOf(item)} ${item.className || getRoomLabel(item.sessionId)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a,b)=>(times[b.sessionId]??0)-(times[a.sessionId]??0) || a.sessionId.localeCompare(b.sessionId));
  const heading = view === "recent" ? "最近の議論" : "議論の履歴";
  return <div ref={fixed.root} className={styles.root}>
    <header ref={fixed.header} className={styles.header}>
      <div className={styles.searchBar}>
        <HistoryMenu view={view} homeUrl={"/home"}/>
        <label className={styles.search}><span className={styles.srOnly}>議論の履歴を検索</span><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="履歴を検索"/></label>
      </div>
    </header>
    <main className={styles.main}>
      <h1 className={styles.srOnly}>{heading}</h1>
      {!data?.error && !source && <p className={styles.emptyText} role="status">履歴を読み込んでいます…</p>}
      {data?.error && <div className={styles.emptyText}><p role="alert">{data.error}</p><button className={styles.retry} onClick={()=>setReload(v=>v+1)}>もう一度読み込む</button></div>}
      {rows?.length===0 && <section className={styles.empty} aria-label="履歴がありません">
        <svg viewBox="0 0 240 180" aria-hidden="true" className={styles.illustration}><ellipse cx="117" cy="163" rx="67" ry="9" fill="#e8f0fe"/><path d="M49 43Q49 23 69 23H161Q181 23 181 43V104Q181 124 161 124H110L76 150V124H69Q49 124 49 104Z" fill="#c2d7fc"/><path d="M75 57h78M75 80h51" stroke="#8ab4f8" strokeWidth="10" strokeLinecap="round"/><circle cx="176" cy="122" r="27" fill="#e8f0fe"/></svg>
        <h2>{query?"一致する議論がありません":view==="recent"?"この端末で最近開いた議論はありません":"議論の履歴はありません"}</h2>
        <p>{query?"別のテーマやクラス名で検索してください。":"参加・ホストした議論がここに表示されます。"}</p>
      </section>}
      {!!rows?.length && <div role="list" aria-label="議論の履歴" className={styles.list}>
        {rows.map(item=><article key={item.sessionId} role="listitem" className={styles.row}>
          <Link href={`/rooms/${encodeURIComponent(item.sessionId)}`} className={`${styles.rowLink} mvp-session-link`}>
            <span className={styles.chat}><Icon name="chat"/></span><div className={styles.copy}><h2>{titleOf(item)}</h2><p>{[item.className || getRoomLabel(item.sessionId),item.role==="host"?"ホスト":item.groupId?`グループ${item.groupId}`:"参加者",item.ended||item.phase==="closed"?"終了":"",openedLabel(times[item.sessionId])].filter(Boolean).join(" · ") || (item.ended||item.phase==="closed"?"終了した議論":"参加中の議論")}</p></div>
          </Link>
        </article>)}
      </div>}
    </main>
  </div>;
}
