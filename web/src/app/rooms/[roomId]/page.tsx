"use client";
import { use, useEffect, useState } from "react";
import { collection, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { callApi } from "@/lib/api";
import { ensureSignedIn, firebase } from "@/lib/firebase";

type Room = { title: string; phase: "collecting" | "discussing" | "consensus" | "closed"; createdBy: string; joinCode?: string; analysis?: { status: string } };
type Insight = { id: string; summary: string; source: "gemini" | "mock"; status: string };
const PHASE_LABEL: Record<Room["phase"], string> = { collecting: "事前意見の受付中", discussing: "議論中", consensus: "合意の確認中", closed: "終了" };

export default function RoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = use(params);
  const [loadedRoom, setLoadedRoom] = useState<{ id: string; value: Room } | null>(null);
  const [uid, setUid] = useState("");
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [opinion, setOpinion] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadedInsights, setLoadedInsights] = useState<{ id: string; value: Insight[] } | null>(null);
  const room = loadedRoom?.id === roomId ? loadedRoom.value : null;
  const isModerator = !!room && room.createdBy === uid;
  const insights = loadedInsights?.id === roomId ? loadedInsights.value : [];

  useEffect(() => {
    let active = true;
    let unsub = () => {};
    ensureSignedIn().then((user) => {
      if (!active) return;
      setUid(user.uid);
      unsub = onSnapshot(doc(firebase().db, `rooms/${roomId}`), (s) => {
        if (!s.exists()) { setError("部屋が見つかりません"); return; }
        setLoadedRoom({ id: roomId, value: s.data() as Room });
      }, (e) => setError(e.message));
    }).catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; unsub(); };
  }, [roomId]);

  useEffect(() => {
    if (!isModerator) return;
    return onSnapshot(collection(firebase().db, `rooms/${roomId}/insights`), (s) => {
      setLoadedInsights({ id: roomId, value: s.docs.map((d) => ({ id: d.id, ...d.data() } as Insight)) });
    }, (e) => setError(e.message));
  }, [roomId, isModerator]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setActionError("");
    try {
      const user = await ensureSignedIn();
      await setDoc(doc(firebase().db, `rooms/${roomId}/privateOpinions/${user.uid}`), { text: opinion, updatedAt: serverTimestamp() });
      setSent(true);
    } catch (err) { setActionError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function moderate(path: "phase" | "analyze") {
    setBusy(true); setActionError("");
    try { await callApi(`/rooms/${roomId}/${path}`, path === "phase" ? { to: "discussing" } : {}); }
    catch (err) { setActionError((err as Error).message); }
    finally { setBusy(false); }
  }

  if (error) return <main role="alert">この部屋を表示できません：{error}</main>;
  if (!room) return <main>読み込み中…</main>;
  return (
    <main style={{ maxWidth: 480, margin: "32px auto", padding: 16, fontFamily: "sans-serif" }}>
      <h1>{room.title}</h1>
      <p data-testid="phase">{PHASE_LABEL[room.phase]}</p>
      {isModerator && (
        <section aria-label="司会者の操作">
          {room.joinCode && <p>参加コード：<strong data-testid="join-code">{room.joinCode}</strong></p>}
          {room.phase === "collecting" && <button disabled={busy} onClick={() => moderate("phase")}>議論を開始する</button>}
          {room.phase === "discussing" && <button disabled={busy || room.analysis?.status === "running"} onClick={() => moderate("analyze")}>{busy || room.analysis?.status === "running" ? "分析中…" : "未検討の論点を分析する"}</button>}
        </section>
      )}
      {room.phase === "collecting" && (
        <form onSubmit={submit} style={{ marginTop: 24 }}>
          <label htmlFor="opinion">あなたの意見（ほかの人には見えません）</label>
          <textarea id="opinion" value={opinion} onChange={(e) => { setOpinion(e.target.value); setSent(false); }} maxLength={1000} rows={5} style={{ display: "block", width: "100%", boxSizing: "border-box" }} />
          <button type="submit" disabled={busy || !opinion.trim()}>提出する</button>
          {sent && <p role="status">提出しました</p>}
        </form>
      )}
      {isModerator && room.phase === "discussing" && (
        <section aria-label="司会者への提案" aria-live="polite">
          <h2>未検討の論点の提案</h2>
          <ul>{insights.map((insight) => <li key={insight.id}><p>{insight.summary}</p><small>{insight.source === "gemini" ? "Geminiによる提案" : "デモデータ"}</small></li>)}</ul>
          {room.analysis?.status === "done" && insights.length === 0 && <p>新しい提案はありません。</p>}
        </section>
      )}
      {actionError && <p role="alert">{actionError}</p>}
    </main>
  );
}
