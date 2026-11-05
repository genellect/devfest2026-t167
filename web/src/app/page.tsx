"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { callApi } from "@/lib/api";
import s from "./page.module.css";

const CODE_LENGTH = 6;
/** 参加コードは英大文字と数字の6文字。貼り付けや小文字の入力もそろえる */
const normalize = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH);

export default function Home() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const { roomId } = await callApi<{ roomId: string }>("/rooms/join", { code });
      router.push(`/rooms/${roomId}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
      input.current?.focus();
    }
  }

  const active = Math.min(code.length, CODE_LENGTH - 1);

  return (
    <main className={s.page}>
      <section className={s.board} aria-labelledby="title">
        <h1 id="title" className={s.title}>今日の議論に参加する</h1>
        <p className={s.lead}>先生の画面に出ている6文字を、そのまま入れてください。</p>

        <form className={s.form} onSubmit={join} noValidate>
          <label htmlFor="code" className={s.label}>参加コード</label>
          <div className={s.cells} data-focused={focused || undefined} onClick={() => input.current?.focus()}>
            {Array.from({ length: CODE_LENGTH }, (_, i) => (
              <span key={i} className={s.cell} data-filled={i < code.length || undefined} data-active={focused && i === active || undefined} aria-hidden="true">
                {code[i] ?? ""}
              </span>
            ))}
            <input
              ref={input}
              id="code"
              className={s.input}
              value={code}
              onChange={(e) => { setCode(normalize(e.target.value)); setError(""); }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              maxLength={CODE_LENGTH}
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              aria-describedby="code-hint"
              aria-invalid={error ? true : undefined}
            />
          </div>
          <p id="code-hint" className={s.hint}>英字と数字の6文字です。小文字で入れても大丈夫です。</p>
          {error && <p role="alert" className={s.error}>{error}</p>}
          <button type="submit" className={s.submit} disabled={busy || code.length !== CODE_LENGTH}>
            {busy ? "参加しています…" : "参加する"}
          </button>
        </form>
      </section>

      <section className={s.flow} aria-labelledby="flow-title">
        <h2 id="flow-title" className={s.flowTitle}>参加したあとの流れ</h2>
        <ol className={s.steps}>
          <li>
            <strong>議論の前に、自分の考えを書く</strong>
            <span>書いた内容は、先生にもほかの人にも見えません。</span>
          </li>
          <li>
            <strong>グループで話し合う</strong>
            <span>まだ話していない論点があると、先生から問いかけが届きます。</span>
          </li>
          <li>
            <strong>結論を自分の言葉で書く</strong>
            <span>同じ結論でも、理解が分かれていないかを確かめます。</span>
          </li>
        </ol>
        <p className={s.privacy}>名前やアカウントの登録はいりません。この端末のまま参加します。</p>
      </section>
    </main>
  );
}
