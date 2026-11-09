"use client";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownLeft, ArrowRight, ArrowUp, ChevronRight, Clock3, History, Home, LogOut, Menu, MessageCircle, Plus, Settings, ShieldCheck, Target, X } from "lucide-react";
import { signOutHost, useHostUser } from "@/lib/hostAuth";
import { sessionRequest } from "@/lib/session";
import { callApi } from "@/lib/api";
import { getReflection } from "@/lib/local";
import { ProfileForm } from "@/components/host/ProfileForm";
import { ClassroomHome } from "@/components/classroom/ClassroomHome";
import { Loading } from "@/components/ui";
import styles from "./mobile-workspace.module.css";

type View = "home" | "history" | "settings";
interface Discussion { sessionId: string; title: string; theme: string; phase: string; ended?: boolean; role: string; className?: string }
const views = [{ id: "home", href: "/home", label: "ホーム", Icon: Home }, { id: "history", href: "/history", label: "履歴", Icon: History }, { id: "settings", href: "/settings", label: "アカウント・設定", Icon: Settings }] as const;
const completed = (room: Discussion) => room.ended || room.phase === "closed";
function GeminiIcon({ size = 22 }: { size?: number }) {
  return <Image src="/brand/gemini.png" width={size} height={size} alt="" aria-hidden="true" className={styles.geminiIcon} />;
}
const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function MobileWorkspace({ view = "home" }: { view?: View }) {
  const user = useHostUser(), router = useRouter();
  const workspace = useRef<HTMLDivElement>(null);
  const drawer = useRef<HTMLDialogElement>(null), assistant = useRef<HTMLDialogElement>(null);
  const [rooms, setRooms] = useState<Discussion[]>(), [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [reflections, setReflections] = useState(0), [busy, setBusy] = useState(false);
  const [request, setRequest] = useState(""), [themes, setThemes] = useState<string[]>([]);
  const [thinking, setThinking] = useState(false), [themeError, setThemeError] = useState("");
  const [lastRequest, setLastRequest] = useState("");
  const [profileSaved, setProfileSaved] = useState(false);
  const [selectedView, setSelectedView] = useState(view);
  const pendingNavigation = useRef<View | null>(null);
  const closing = useRef(false);
  const previousOverflow = useRef<string | null>(null);
  const drag = useRef<{ start: number; distance: number; opening: boolean } | undefined>(undefined);

  const closePanel = useCallback(async (panel: HTMLDialogElement | null) => {
    if (!panel?.open || closing.current) return;
    closing.current = true;
    panel.classList.add(styles.closing);
    panel.querySelector("textarea")?.blur();
    if (!reduceMotion()) {
      const isDrawer = panel === drawer.current;
      const frames = isDrawer ? [
        { transform: getComputedStyle(panel).transform, opacity: 1 },
        { transform: "translateX(-100%)", opacity: 1 },
      ] : [
        { clipPath: "inset(0 0 0 round 0)", opacity: 1 },
        { clipPath: panel.style.getPropertyValue("--assistant-origin") || "inset(12px 16px calc(100% - 70px) round 30px)", opacity: .5 },
      ];
      await panel.animate(frames, { duration: isDrawer ? 180 : 240, easing: "cubic-bezier(.4,0,1,1)" }).finished.catch(() => {});
    }
    panel.close(); panel.classList.remove(styles.closing);
    panel.style.transform = ""; panel.style.animation = "";
    if (!drawer.current?.open && !assistant.current?.open && previousOverflow.current !== null) {
      document.body.style.overflow = previousOverflow.current; previousOverflow.current = null;
    }
    closing.current = false;
  }, []);
  function lockBody() {
    if (previousOverflow.current === null) previousOverflow.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  function openDrawer() {
    assistant.current?.querySelector("textarea")?.blur();
    lockBody(); drawer.current?.showModal(); drawer.current?.focus({ preventScroll: true });
  }
  function openAssistant() {
    const panel = assistant.current, origin = workspace.current?.querySelector("header")?.getBoundingClientRect();
    if (!panel) return;
    const viewport = window.visualViewport;
    panel.style.setProperty("--assistant-height", `${viewport?.height ?? window.innerHeight}px`);
    panel.style.setProperty("--assistant-top", `${viewport?.offsetTop ?? 0}px`);
    lockBody(); panel.showModal();
    if (origin) {
      const bounds = panel.getBoundingClientRect();
      const top = Math.max(0, origin.top - bounds.top), bottom = Math.min(bounds.height, Math.max(top, origin.bottom - bounds.top));
      panel.style.setProperty("--assistant-origin", `inset(${top}px ${Math.max(0, bounds.right - origin.right)}px calc(100% - ${bottom}px) ${Math.max(0, origin.left - bounds.left)}px round 30px)`);
    }
    panel.focus({ preventScroll: true });
  }
  async function navigate(href: string) {
    const destination = views.find(item => item.href === href);
    if (!destination || closing.current) return;
    setSelectedView(destination.id);
    pendingNavigation.current = destination.id;
    // Geminiの上にメニューが開いている場合も、移動先の画面を背面に出す。
    assistant.current?.close();
    if (destination.id === view) {
      pendingNavigation.current = null;
      if (!reduceMotion()) await new Promise(resolve => window.setTimeout(resolve, 90));
      await closePanel(drawer.current);
    } else router.push(href);
  }
  function backdrop(event: React.MouseEvent<HTMLDialogElement>) {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) void closePanel(event.currentTarget);
  }
  function beginDrag(event: React.PointerEvent, opening: boolean) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    drag.current = { start: event.clientX, distance: 0, opening };
    if (opening) event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveDrag(event: React.PointerEvent) {
    const gesture = drag.current, panel = drawer.current;
    if (!gesture || !panel) return;
    const dx = event.clientX - gesture.start;
    if (Math.abs(dx) < 8 && !gesture.distance) return;
    if (gesture.opening && dx <= 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.distance = dx;
    if (!panel.open) { lockBody(); panel.showModal(); panel.focus({ preventScroll: true }); }
    panel.style.animation = "none";
    const width = panel.getBoundingClientRect().width;
    panel.style.transform = `translateX(${gesture.opening ? Math.min(0, -width + dx) : Math.min(0, dx)}px)`;
  }
  function finishDrag() {
    const gesture = drag.current, panel = drawer.current;
    drag.current = undefined;
    if (!gesture || !panel?.open || Math.abs(gesture.distance) < 8) return;
    if (gesture.opening ? gesture.distance < 64 : gesture.distance < -64) { void closePanel(panel); return; }
    const animation = panel.animate([{ transform: panel.style.transform }, { transform: "translateX(0)" }], { duration: reduceMotion() ? 0 : 200, easing: "cubic-bezier(.2,0,0,1)", fill: "forwards" });
    void animation.finished.then(() => { panel.style.transform = ""; panel.style.animation = "none"; animation.cancel(); }).catch(() => {});
  }
  function ripple(event: React.PointerEvent<HTMLDivElement>) {
    if (reduceMotion()) return;
    const target = (event.target as Element).closest<HTMLElement>("button, a");
    if (!target || target.getAttribute("aria-disabled") === "true" || target.hasAttribute("disabled")) return;
    const bounds = target.getBoundingClientRect(), size = Math.max(bounds.width, bounds.height) * 2;
    const mark = document.createElement("span"); mark.className = styles.ripple;
    mark.setAttribute("aria-hidden", "true");
    Object.assign(mark.style, { width: `${size}px`, height: `${size}px`, left: `${event.clientX - bounds.left - size / 2}px`, top: `${event.clientY - bounds.top - size / 2}px` });
    target.append(mark); mark.addEventListener("animationend", () => mark.remove(), { once: true });
  }

  useEffect(() => {
    setSelectedView(view);
    if (!drawer.current?.open || (pendingNavigation.current && pendingNavigation.current !== view)) return;
    pendingNavigation.current = null;
    // 移動先を描画してから、選択背景を見せつつメニューを閉じる。
    const timer = window.setTimeout(() => { void closePanel(drawer.current); }, reduceMotion() ? 0 : 90);
    return () => window.clearTimeout(timer);
  }, [view, closePanel]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setRooms(undefined); setError("");
    sessionRequest<{ sessions: Discussion[] }>("/discussions").then(({ sessions }) => {
      if (!active) return;
      setRooms(sessions);
      setReflections(sessions.filter(room => getReflection(room.sessionId).savedAt).length);
    }).catch(() => { if (active) setError("履歴を読み込めませんでした。もう一度ページを開いてください。"); });
    return () => { active = false; };
  }, [user]);

  useEffect(() => {
    const viewport = window.visualViewport;
    let frame = 0;
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // 閉じる最中は寸法を固定し、キーボードの収納と縮小アニメーションを重ねない。
        if (closing.current) return;
        assistant.current?.style.setProperty("--assistant-height", `${viewport?.height ?? window.innerHeight}px`);
        assistant.current?.style.setProperty("--assistant-top", `${viewport?.offsetTop ?? 0}px`);
      });
    };
    resize(); viewport?.addEventListener("resize", resize); viewport?.addEventListener("scroll", resize);
    window.addEventListener("resize", resize);
    if (drawer.current?.open || assistant.current?.open) document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", resize); viewport?.removeEventListener("scroll", resize);
      window.removeEventListener("resize", resize);
      if (previousOverflow.current !== null) document.body.style.overflow = previousOverflow.current;
    };
  }, [user]);

  async function host(theme = "") {
    setBusy(true); setError("");
    try {
      await closePanel(assistant.current);
      router.push(`/host/new${theme ? `?theme=${encodeURIComponent(theme)}` : ""}`);
    } catch { setError("作成画面を開けませんでした。接続を確認してください。"); }
    finally { setBusy(false); }
  }

  async function suggest(event: React.FormEvent) {
    event.preventDefault();
    if (!request.trim() || thinking) return;
    setThinking(true); setThemeError(""); setLastRequest(request.trim());
    try {
      const result = await callApi<{ themes: string[] }>("/themes/suggest", { request: request.trim(), previous: themes });
      setThemes(result.themes);
    } catch (err) { setThemeError((err as Error).message || "テーマ案を取得できませんでした。"); }
    finally { setThinking(false); }
  }

  if (!user) return <Loading />;
  const name = user.displayName || "あなた";
  const initial = (user.displayName || user.email || "T").charAt(0).toUpperCase();
  const visible = (rooms ?? []).filter(room => `${room.theme} ${room.title} ${room.className ?? ""}`.toLowerCase().includes(filter.toLowerCase()));

  function roomList(items: Discussion[]) {
    return <div className={styles.roomList}>{items.map(room => <Link key={room.sessionId} href={`/rooms/${room.sessionId}`} className={`${styles.room} mvp-session-link`}>
      <span className={styles.roomIcon}><MessageCircle size={21} aria-hidden="true" /></span>
      <span className={styles.roomText}><strong>{room.theme || room.title}</strong><small>{room.className ? `${room.className} · ` : ""}{room.role === "host" ? "ホスト" : "参加者"} · {completed(room) ? "終了" : room.phase === "collecting" ? "準備中" : "進行中"}</small></span>
      <ChevronRight size={18} aria-hidden="true" />
    </Link>)}</div>;
  }

  return <div ref={workspace} className={styles.workspace} onPointerDownCapture={ripple}>
    <div className={styles.swipeEdge} aria-hidden="true" onPointerDown={event => beginDrag(event, true)} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag} />
    <aside className={styles.desktopSidebar} aria-label="サイドメニュー">
      <Link href="/home" className={styles.desktopBrand}>Topos</Link>
      <nav aria-label="メインメニュー">{views.map(({ id, href, label, Icon }) => <Link key={id} href={href} aria-current={view === id ? "page" : undefined}><Icon size={22} aria-hidden="true" />{label}</Link>)}</nav>
    </aside>
    <header className={`${styles.header} ${view === "settings" ? styles.minimalHeader : ""}`}>
      <button className={styles.iconButton} aria-label="メニューを開く" aria-haspopup="dialog" onClick={openDrawer}><Menu size={23} /></button>
      {view === "home" && <>
        <button className={styles.assistantTrigger} aria-haspopup="dialog" onClick={openAssistant}><GeminiIcon /><span>Geminiでテーマを考える</span></button>
        <Link className={styles.avatar} href="/settings" aria-label="アカウント・設定">{initial}</Link>
      </>}
      {view === "history" && <label className={styles.headerSearch}>
        <input aria-label="履歴を検索" placeholder="履歴を検索" value={filter} onChange={event => setFilter(event.target.value)} />
        {filter && <button type="button" className={styles.iconButton} aria-label="検索をクリア" onClick={() => setFilter("")}><X size={20} /></button>}
      </label>}
    </header>

    <main key={view} className={styles.main}>
      <div className={styles.pageHeading}><h1>{views.find(item => item.id === view)?.label}</h1></div>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {view === "home" && <>
        <div className={styles.actions}>
          <Link href="/join" className={styles.join} aria-label="参加する"><ArrowDownLeft className={styles.actionMark} aria-hidden="true" strokeWidth={1} /><strong aria-hidden="true">参加<br />する</strong></Link>
          <button className={styles.host} onClick={() => void host()} disabled={busy} aria-label={busy ? "開いています…" : "ホストする"}><Plus className={styles.actionMark} aria-hidden="true" strokeWidth={1.3} /><strong aria-hidden="true">{busy ? <>準備<br />中</> : <>ホスト<br />する</>}</strong></button>
        </div>
        <section className={styles.dashboard} aria-labelledby="dashboard-title">
          <h2 id="dashboard-title">マイダッシュボード</h2>
          <div className={styles.stats}>
            <div><MessageCircle size={19} aria-hidden="true" /><strong>{rooms ? rooms.length : "—"}</strong><span>参加した議論</span></div>
            <div><ShieldCheck size={19} aria-hidden="true" /><strong>{rooms ? rooms.filter(completed).length : "—"}</strong><span>終了した議論</span></div>
            <div><Target size={19} aria-hidden="true" /><strong>{rooms ? reflections : "—"}</strong><span>振り返り</span></div>
          </div>
        </section>
        <ClassroomHome />
        <section aria-labelledby="recent-title"><div className={styles.sectionHeading}><h2 id="recent-title">最近の議論</h2><Link href="/history">すべて見る<ChevronRight size={16} /></Link></div>
          {!rooms && !error && <p role="status" className={styles.empty}>読み込んでいます…</p>}
          {rooms?.length === 0 && <div className={styles.empty}><MessageCircle size={30} aria-hidden="true" /><h3>最初の議論をはじめよう</h3><Link href="/join">議論に参加する<ArrowRight size={16} /></Link></div>}
          {rooms && roomList(rooms.slice(0, 3))}
        </section>
      </>}

      {view === "history" && <>
        {!rooms && !error && <p className={styles.empty} role="status">履歴を読み込んでいます…</p>}
        {rooms && <p className={styles.resultCount}>{visible.length}件の議論</p>}
        {rooms && visible.length === 0 && <div className={styles.empty}><History size={30} aria-hidden="true" /><h3>{filter ? "一致する議論はありません" : "履歴はまだありません"}</h3><p>{filter ? "別の言葉で検索してみてください。" : "議論に参加すると、自分の履歴を確認できます。"}</p></div>}
        {roomList(visible)}
      </>}

      {view === "settings" && <>
        <section className={styles.identity}><span className={styles.largeAvatar}>{initial}</span><h2>{name}</h2><p>{user.email}</p></section>
        <details className={styles.profile}><summary>プロフィール</summary><ProfileForm defaultName={user.displayName ?? ""} submitLabel="保存する" onSaved={() => setProfileSaved(true)} />{profileSaved && <p role="status">保存しました。</p>}</details>
        <div className={styles.settingsList}>
          <Link href="/sessions"><span><Clock3 size={21} />端末とセッション</span><ChevronRight size={18} /></Link>
          <Link href="/about"><span><ShieldCheck size={21} />プライバシー</span><ChevronRight size={18} /></Link>
          <button disabled={busy} onClick={async () => { setBusy(true); try { await signOutHost(); router.replace("/"); } catch { setError("ログアウトできませんでした。接続を確認してください。"); setBusy(false); } }}><span><LogOut size={21} />{busy ? "ログアウトしています…" : "ログアウト"}</span><ChevronRight size={18} /></button>
        </div>
      </>}
    </main>

    <dialog ref={drawer} className={styles.drawer} tabIndex={-1} aria-label="メニュー" onClick={backdrop} onCancel={event => { event.preventDefault(); void closePanel(drawer.current); }} onPointerDown={event => beginDrag(event, false)} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
      <div className={styles.drawerHeading}><span>Topos</span></div>
      <nav aria-label="メインメニュー">{views.map(({ id, href, label, Icon }) => <Link key={id} href={href} aria-current={selectedView === id ? "page" : undefined} onClick={event => { event.preventDefault(); void navigate(href); }}><Icon size={24} aria-hidden="true" />{label}</Link>)}</nav>
    </dialog>

    <dialog ref={assistant} className={styles.assistant} tabIndex={-1} aria-labelledby="theme-dialog-title" onClick={backdrop} onCancel={event => { event.preventDefault(); void closePanel(assistant.current); }}>
      <div className={styles.assistantToolbar}>
        <button className={styles.iconButton} aria-label="Geminiのメニューを開く" onClick={openDrawer}><Menu size={22} /></button>
        <div><h2 id="theme-dialog-title">Gemini</h2><span>テーマ相談</span></div>
        <button className={styles.iconButton} aria-label="テーマ相談を閉じる" onClick={() => void closePanel(assistant.current)}><X size={23} /></button>
      </div>
      <div className={styles.assistantBody}>
        {!themes.length && !thinking && <section className={styles.welcome}>
          <GeminiIcon size={40} />
          <h3>こんにちは。<br />さっそく始めましょう</h3>
        </section>}
        {(themes.length > 0 || thinking) && <div className={styles.conversation}>
          <p className={styles.userMessage}>{lastRequest}</p>
          {thinking && <p className={styles.thinking} role="status"><GeminiIcon size={24} />テーマを考えています…</p>}
          {!thinking && themes.length > 0 && <div className={styles.themes} aria-live="polite"><GeminiIcon size={28} /><h3>こんなテーマはどうですか？</h3>{themes.map(theme => <button key={theme} disabled={busy} onClick={() => void host(theme)}><span>{theme}</span><ArrowRight size={19} aria-hidden="true" /></button>)}<p>選んだテーマで作成画面を開きます。</p></div>}
        </div>}
        {themeError && <p role="alert" className={styles.error}>{themeError}</p>}
      </div>
      <form className={styles.composer} onSubmit={event => void suggest(event)}>
        <GeminiIcon size={24} />
        <label htmlFor="theme-request" className="sr-only">どんなことを話し合いたい？</label>
        <textarea id="theme-request" maxLength={500} rows={1} value={request} onChange={event => {
          setRequest(event.target.value); event.target.style.height = "auto"; event.target.style.height = `${Math.min(event.target.scrollHeight, 120)}px`;
        }} onKeyDown={event => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!thinking && request.trim()) event.currentTarget.form?.requestSubmit(); }
        }} placeholder="Geminiに相談" required />
        <button className={styles.suggest} data-thinking={thinking || undefined} disabled={thinking || !request.trim()} aria-label={thinking ? "考えています…" : themes.length ? "別の案を考える" : "テーマを提案してもらう"}><ArrowUp size={22} aria-hidden="true" /></button>
      </form>
    </dialog>
  </div>;
}
