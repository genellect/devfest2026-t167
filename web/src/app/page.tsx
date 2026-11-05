"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { callApi } from "@/lib/api";
import { signInModerator } from "@/lib/firebase";

export default function Home() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const { roomId } = await callApi<{ roomId: string }>("/rooms/join", { code });
      router.push(`/rooms/${roomId}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await signInModerator();
      const { roomId } = await callApi<{ roomId: string }>("/rooms", { title: title.trim() });
      router.push(`/rooms/${roomId}`);
    } catch (err) {
      setError(`ログインまたは部屋の作成ができませんでした：${(err as Error).message}`);
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 480, margin: "48px auto", padding: 16, fontFamily: "sans-serif" }}>
      <h1>みんなの考えが活きる議論へ</h1>
      <form onSubmit={join}>
        <label htmlFor="code">参加コード</label>
        <input id="code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} autoComplete="off" style={{ display: "block", fontSize: 24, width: "100%", margin: "8px 0", boxSizing: "border-box" }} />
        <button type="submit" disabled={busy || code.length !== 6}>参加する</button>
      </form>
      <section aria-labelledby="moderator-heading" style={{ marginTop: 40 }}>
        <h2 id="moderator-heading">司会者として始める</h2>
        <form onSubmit={create}>
          <label htmlFor="title">議論のテーマ</label>
          <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} style={{ display: "block", width: "100%", margin: "8px 0", boxSizing: "border-box" }} />
          <button type="submit" disabled={busy || !title.trim()}>Googleでログインして部屋を作る</button>
        </form>
      </section>
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
