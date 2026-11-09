"use client";
import Link from "next/link";
import { ArrowRight, ScanLine } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { QrScanner } from "@/components/QrScanner";
import { callApi } from "@/lib/api";
import { sessionRequest } from "@/lib/session";
import { signOutHost } from "@/lib/hostAuth";
import { normalizeJoinCode, typedJoinCode, pendingJoinCode, clearJoinCode } from "@/lib/join-code";
import styles from "./join-card.module.css";

const CODE_LENGTH = 6;

/**
 * 「議論に参加する」カード（Figma「最新」02-S）。参加コードの6マスと、参加・カメラで読み取るの2つのボタン。
 * ホームと /join の両方で使う。QR コードやリンク（?code=000000）で開いたときは、ボタンを押さずにそのまま参加する。
 */
export function JoinForm({ autoJoin = false, simple = false }: { autoJoin?: boolean; simple?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const input = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [code, setCode] = useState(() => autoJoin ? normalizeJoinCode(params.get("code") ?? pendingJoinCode()) : "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  // 部屋を作ったアカウントのまま参加しようとしたときの部屋（ホストのまま入るので、確認を出す）
  const [ownRoom, setOwnRoom] = useState<string>();

  const join = useCallback(async (value: string) => {
    setBusy(true); setError(""); setOwnRoom(undefined);
    try {
      const { roomId } = await callApi<{ roomId: string }>("/rooms/join", { code: value });
      clearJoinCode();
      const member = await sessionRequest<{ role: string }>(`/rooms/${roomId}/me`);
      if (member.role === "host") { setOwnRoom(roomId); setBusy(false); return; }
      // QRやリンク（?code=）から来たときは履歴を置き換える。戻るで ?code= の画面に戻り、自動参加で部屋へ連れ戻されないようにする
      const destination = `/rooms/${roomId}`;
      if (params.get("code")) router.replace(destination); else router.push(destination);
    } catch (err) {
      clearJoinCode();
      setError((err as Error).message);
      setBusy(false);
      input.current?.focus(); // すぐ打ち直せるように
    }
  }, [router, params]);

  const autoJoined = useRef(false);
  useEffect(() => {
    if (!autoJoin || autoJoined.current || code.length !== CODE_LENGTH) return;
    autoJoined.current = true;
    void join(code);
    // 開いたときのコードだけを使う
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scanned = useCallback((value: string) => { setScanning(false); setCode(value); void join(value); }, [join]);

  async function switchAccount() {
    setBusy(true);
    await signOutHost();
    router.push("/");
  }

  if (ownRoom) {
    return (
      <section className="flow-card" role="alert">
        <h2 className="flow-card__title">この部屋を作ったアカウントです</h2>
        <p>このまま進むと、ホストの画面が開きます。参加者の画面を試すときは、別のGoogleアカウントでログインしてください。</p>
        <div className="home-actions">
          <Link className="btn btn--blue" href={`/rooms/${ownRoom}`}>ホストの画面を開く</Link>
          <button className="btn" onClick={switchAccount} disabled={busy}>{busy ? "ログアウトしています…" : "アカウントを切り替える"}</button>
        </div>
      </section>
    );
  }

  if (scanning) return <section className="flow-card"><QrScanner onCode={scanned} onClose={() => setScanning(false)} /></section>;

  const active = Math.min(code.length, CODE_LENGTH - 1);
  return (
    <form className={`flow-card join-card ${styles.card}`} aria-labelledby="join-title" onSubmit={(e) => { e.preventDefault(); void join(code); }} noValidate>
      <h2 id="join-title" className="flow-card__title">{simple ? "参加する" : "議論に参加する"}</h2>
      <div className="field">
        <label className={simple ? "sr-only" : "home-code-label"} htmlFor="code">参加コード（数字6桁）</label>
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
            aria-describedby={error ? "code-error" : undefined} aria-invalid={error ? true : undefined}
            onChange={(e) => { setCode(typedJoinCode(e.target.value)); setError(""); }}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
        </div>
      </div>
      {error && <p id="code-error" className="notice notice--error" role="alert">{error}</p>}
      <div className="home-actions">
        <button className="btn btn--blue" type="submit" disabled={busy || code.length !== CODE_LENGTH}>
          {busy ? "参加しています…" : "参加する"}
          <ArrowRight className={styles.icon} size={20} aria-hidden="true" />
        </button>
        <span className={styles.divider} aria-hidden="true">または</span>
        <button type="button" className="btn" onClick={() => { setError(""); setScanning(true); }} disabled={busy}><ScanLine className={styles.icon} size={20} aria-hidden="true" />カメラで読み取る</button>
      </div>
    </form>
  );
}
