"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Header } from "@/components/ui";
import { callApi } from "@/lib/api";

/** P1 参加コード入力。QR コードからは ?code=XXXXXX 付きで開く */
function JoinForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [code, setCode] = useState(() => (params.get("code") ?? "").toUpperCase().slice(0, 6));
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

  return (
    <form className="box box--lg card card--narrow" onSubmit={join}>
      <h2 className="card__title">参加コードを入力</h2>
      <div className="field">
        <label className="field__label" htmlFor="code">参加コード</label>
        <input id="code" className="input input--code" value={code} inputMode="text" autoComplete="off" autoCapitalize="characters"
          maxLength={6} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} />
        <p className="field__hint">先生の画面に表示されている6文字です。登録やログインはいりません。</p>
      </div>
      {error && <p className="notice notice--error" role="alert">{error}</p>}
      <button className="btn btn--blue btn--block" type="submit" disabled={busy || code.length !== 6}>
        {busy ? "参加しています…" : "参加する"}
      </button>
    </form>
  );
}

export default function JoinPage() {
  return (
    <main className="screen">
      <Header title="議論に参加する"><Link className="btn btn--small" href="/student">戻る</Link></Header>
      <div className="body body--center">
        <Suspense><JoinForm /></Suspense>
      </div>
    </main>
  );
}
