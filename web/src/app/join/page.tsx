"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";
import { TabBar } from "@/components/nav";
import { Header } from "@/components/ui";
import { parseDiscussionQr, readQrImage } from "@/lib/discussion-qr";
import { callApi } from "@/lib/api";
import { sessionRequest } from "@/lib/session";
import { signOutHost } from "@/lib/hostAuth";
import { normalizeJoinCode, pendingJoinCode, clearJoinCode } from "@/lib/join-code";

const CODE_LENGTH = 6;
/** 参加コードは英大文字と数字の6文字。小文字・空白・ハイフン入りの貼り付けもそろえる */
const normalize = normalizeJoinCode;

/** P1 参加コード入力。QR コードからは ?code=XXXXXX 付きで開く */
function JoinForm() {
  const router = useRouter();
  const params = useSearchParams();
  const input = useRef<HTMLInputElement>(null);
  const [method, setMethod] = useState<"code" | "qr">("code");
  const [code, setCode] = useState(() => normalize(params.get("code") ?? pendingJoinCode()));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  // 部屋を作ったHostのアカウントのまま参加しようとしたときの部屋（司会者のまま入るので、確認を出す）
  const [ownRoom, setOwnRoom] = useState<string>();

  async function join(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true); setError(""); setOwnRoom(undefined);
    try {
      const { roomId } = await callApi<{ roomId: string }>("/rooms/join", { code });
      clearJoinCode();
      const member = await sessionRequest<{ role: string }>(`/rooms/${roomId}/me`);
      if (member.role === "host") { setOwnRoom(roomId); setBusy(false); return; }
      router.push(`/rooms/${roomId}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
      input.current?.focus(); // すぐ打ち直せるように
    }
  }

  /** Hostのアカウントからログアウトし、別のGoogleアカウントで入り直す */
  async function joinAsStudent() {
    setBusy(true);
    await signOutHost();
    router.push("/");
  }

  if (ownRoom) {
    return (
      <div className="box box--lg card card--narrow" role="alert">
        <h2 className="card__title">この部屋を作ったHostのアカウントです</h2>
        <p className="t-label">このまま進むと、Hostの画面が開きます。参加者の画面を試すときは、ログアウトしてGoogleアカウントを切り替えるか、別の端末やシークレットウィンドウで開いてください。</p>
        <button className="btn btn--blue btn--block" onClick={joinAsStudent} disabled={busy}>{busy ? "参加しています…" : "ログアウトしてGoogleアカウントを切り替える"}</button>
        <Link className="btn btn--block" href={`/rooms/${ownRoom}`}>Hostの画面を開く</Link>
      </div>
    );
  }

  const active = Math.min(code.length, CODE_LENGTH - 1);
  return (
    <form className="box box--lg card card--narrow" onSubmit={join} noValidate>
      <h2 className="card__title">参加方法を選択</h2>
      <div className="choices"><button type="button" className="choice" aria-pressed={method === "code"} onClick={() => setMethod("code")}>コードで参加</button><button type="button" className="choice" aria-pressed={method === "qr"} onClick={() => setMethod("qr")}>QRで参加</button></div>
      {method === "qr" && <label className="field">QRを撮影または画像を選択<input type="file" accept="image/*" capture="environment" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; setBusy(true); setError(""); try { const code = parseDiscussionQr(await readQrImage(file), location.origin); if (!code) throw new Error("このアプリの参加用QRを読み取ってください"); setCode(code); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }} /><span>画像は端末内で読み取り、サーバーには送りません。</span></label>}
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
        <p id="code-hint" className="field__hint">Hostの画面に表示されている英字と数字の6文字です。小文字で入れても大丈夫です。Googleログインが必要です。</p>
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
