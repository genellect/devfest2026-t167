"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { TabBar } from "@/components/nav";
import { Header } from "@/components/ui";
import { callApi } from "@/lib/api";
import { ensureSignedIn, firebase } from "@/lib/firebase";
import { signOutHost } from "@/lib/hostAuth";

const CODE_LENGTH = 6;
/** 参加コードは英大文字と数字の6文字。小文字・空白・ハイフン入りの貼り付けもそろえる */
const normalize = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH);

/** P1 参加コード入力。QR コードからは ?code=XXXXXX 付きで開く */
function JoinForm() {
  const router = useRouter();
  const params = useSearchParams();
  const input = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState(() => normalize(params.get("code") ?? ""));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
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
      input.current?.focus(); // すぐ打ち直せるように
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

  const active = Math.min(code.length, CODE_LENGTH - 1);
  return (
    <form className="box box--lg card card--narrow" onSubmit={join} noValidate>
      <h2 className="card__title">参加コードを入力</h2>
      <div className="field">
        <label className="field__label" htmlFor="code">参加コード</label>
        {/* 見た目は6マス。入力欄は透明な1つだけなので、貼り付け・自動入力・読み上げはふつうの入力欄と同じに動く */}
        <div className="code" data-invalid={error ? true : undefined}>
          {Array.from({ length: CODE_LENGTH }, (_, i) => (
            <span key={i} className="code__cell" aria-hidden="true"
              data-filled={i < code.length || undefined} data-active={(focused && i === active) || undefined}>
              {code[i] ?? ""}
            </span>
          ))}
          <input ref={input} id="code" className="code__input" value={code}
            inputMode="text" autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="go"
            aria-describedby={error ? "code-hint code-error" : "code-hint"} aria-invalid={error ? true : undefined}
            onChange={(e) => { setCode(normalize(e.target.value)); setError(""); }}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
        </div>
        <p id="code-hint" className="field__hint">先生の画面に表示されている英字と数字の6文字です。小文字で入れても大丈夫です。登録やログインはいりません。</p>
      </div>
      {error && <p id="code-error" className="notice notice--error" role="alert">{error}</p>}
      <button className="btn btn--blue btn--block" type="submit" disabled={busy || code.length !== CODE_LENGTH}>
        {busy ? "参加しています…" : "参加する"}
      </button>
    </form>
  );
}

export default function JoinPage() {
  return (
    <main className="screen screen--tabs">
      <Header title="議論に参加する" nav={<TabBar role="student" />} />
      <div className="body body--center">
        <Suspense><JoinForm /></Suspense>
      </div>
    </main>
  );
}
