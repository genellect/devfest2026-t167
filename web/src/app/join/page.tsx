"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { TabBar } from "@/components/nav";
import { Header } from "@/components/ui";
import { QrScanner } from "@/components/QrScanner";
import { callApi } from "@/lib/api";
import { sessionRequest } from "@/lib/session";
import { signOutHost } from "@/lib/hostAuth";
import { normalizeJoinCode, typedJoinCode, pendingJoinCode, clearJoinCode } from "@/lib/join-code";

const CODE_LENGTH = 6;

/** P1 参加コード入力。QR コードからは ?code=000000 付きで開き、そのまま参加する */
function JoinForm() {
  const router = useRouter();
  const params = useSearchParams();
  const input = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [code, setCode] = useState(() => normalizeJoinCode(params.get("code") ?? pendingJoinCode()));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  // 部屋を作ったHostのアカウントのまま参加しようとしたときの部屋（司会者のまま入るので、確認を出す）
  const [ownRoom, setOwnRoom] = useState<string>();

  const join = useCallback(async (value: string) => {
    setBusy(true); setError(""); setOwnRoom(undefined);
    try {
      const { roomId } = await callApi<{ roomId: string }>("/rooms/join", { code: value });
      clearJoinCode();
      const member = await sessionRequest<{ role: string }>(`/rooms/${roomId}/me`);
      if (member.role === "host") { setOwnRoom(roomId); setBusy(false); return; }
      router.push(`/rooms/${roomId}`);
    } catch (err) {
      clearJoinCode();
      setError((err as Error).message);
      setBusy(false);
      input.current?.focus(); // すぐ打ち直せるように
    }
  }, [router]);

  // QRやリンク（?code=）で開いたときは、ボタンを押さずにそのまま参加する（1回だけ）
  const autoJoined = useRef(false);
  useEffect(() => {
    if (autoJoined.current || code.length !== CODE_LENGTH) return;
    autoJoined.current = true;
    void join(code);
    // 開いたときのコードだけを使う
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scanned = useCallback((value: string) => { setScanning(false); setCode(value); void join(value); }, [join]);

  /** Hostのアカウントからログアウトし、別のGoogleアカウントで入り直す */
  async function joinAsStudent() {
    setBusy(true);
    await signOutHost();
    router.push("/");
  }

  if (ownRoom) {
    return (
      <div className="box box--lg card card--narrow" role="alert">
        <h2 className="card__title">この部屋を作ったアカウントです</h2>
        <p className="t-label">このまま進むと、教員の画面が開きます。参加者の画面を試すときは、別のGoogleアカウントでログインしてください。</p>
        <button className="btn btn--blue btn--block" onClick={joinAsStudent} disabled={busy}>{busy ? "ログアウトしています…" : "ログアウトしてアカウントを切り替える"}</button>
        <Link className="btn btn--block" href={`/rooms/${ownRoom}`}>教員の画面を開く</Link>
      </div>
    );
  }

  if (scanning) return <div className="card card--narrow"><QrScanner onCode={scanned} onClose={() => setScanning(false)} /></div>;

  const active = Math.min(code.length, CODE_LENGTH - 1);
  return (
    <form className="box box--lg card card--narrow" onSubmit={(e) => { e.preventDefault(); void join(code); }} noValidate>
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
            inputMode="numeric" pattern="[0-9]*" autoComplete="off" spellCheck={false} enterKeyHint="go"
            aria-describedby={error ? "code-hint code-error" : "code-hint"} aria-invalid={error ? true : undefined}
            onChange={(e) => { setCode(typedJoinCode(e.target.value)); setError(""); }}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
        </div>
        <p id="code-hint" className="field__hint">教員の画面に表示された6桁の数字</p>
      </div>
      {error && <p id="code-error" className="notice notice--error" role="alert">{error}</p>}
      <button className="btn btn--blue btn--block" type="submit" disabled={busy || code.length !== CODE_LENGTH}>
        {busy ? "参加しています…" : "参加する"}
      </button>
      <p className="join-or" aria-hidden="true">または</p>
      <button type="button" className="btn btn--block" onClick={() => { setError(""); setScanning(true); }} disabled={busy}>
        <svg className="btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><path d="M8 12h8" /></svg>
        QRコードを読み取る
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
