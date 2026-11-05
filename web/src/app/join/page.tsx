"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { Header } from "@/components/ui";
import { callApi } from "@/lib/api";
import { ensureSignedIn, firebase } from "@/lib/firebase";
import { signOutHost } from "@/lib/hostAuth";

/** P1 参加コード入力。QR コードからは ?code=XXXXXX 付きで開く */
function JoinForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [code, setCode] = useState(() => (params.get("code") ?? "").toUpperCase().slice(0, 6));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // 部屋を作った先生のアカウントのまま参加しようとしたときの部屋（司会者のまま入るので、確認を出す）
  const [ownRoom, setOwnRoom] = useState<string>();

  async function join(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true); setError(""); setOwnRoom(undefined);
    try {
      const { roomId } = await callApi<{ roomId: string }>("/rooms/join", { code });
      const me = await ensureSignedIn();
      const member = await getDoc(doc(firebase().db, `rooms/${roomId}/members/${me.uid}`));
      if (member.get("role") === "moderator") { setOwnRoom(roomId); setBusy(false); return; }
      router.push(`/rooms/${roomId}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  /** 先生のアカウントからログアウトし、ログインなし（匿名）の生徒として参加し直す */
  async function joinAsStudent() {
    setBusy(true);
    await signOutHost();
    await join();
  }

  if (ownRoom) {
    return (
      <div className="box box--lg card card--narrow" role="alert">
        <h2 className="card__title">この部屋を作った先生のアカウントです</h2>
        <p className="t-label">このまま進むと、先生の画面が開きます。生徒の画面を試すときは、ログアウトして生徒として参加するか、別の端末やシークレットウィンドウで開いてください。</p>
        <button className="btn btn--blue btn--block" onClick={joinAsStudent} disabled={busy}>{busy ? "参加しています…" : "ログアウトして生徒として参加する"}</button>
        <Link className="btn btn--block" href={`/rooms/${ownRoom}`}>先生の画面を開く</Link>
      </div>
    );
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
