"use client";
import { useState } from "react";
import { ApiError, callApi } from "@/lib/api";

/**
 * 議論のテーマ案（Gemini）。教員が授業や話し合いたいことを書くと、考えが分かれそうな問いを3つ出す。
 * 選んだ案はテーマの欄に入り、そのまま書き直せる。依頼の本文は保存しない。
 */
export function ThemeIdeas({ chosen, onPick }: { chosen: string; onPick: (theme: string) => void }) {
  const [request, setRequest] = useState(""), [themes, setThemes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function suggest(another: boolean) {
    if (!request.trim() || busy) return;
    setBusy(true); setError("");
    try {
      const r = await callApi<{ themes: string[] }>("/themes/suggest", { request: request.trim(), previous: another ? themes : [] });
      setThemes(r.themes);
    } catch (e) {
      const err = e as ApiError;
      setError(err.status === 429 ? `続けて出せるのは1分に6回までです。${err.retryAfterSec ?? 60}秒ほど待ってください。` : err.message);
    } finally { setBusy(false); }
  }
  return (
    <section className="ideas" aria-labelledby="ideas-title">
      <h3 id="ideas-title" className="t-sm">テーマ案を出してもらう</h3>
      <label className="field__label" htmlFor="ideas-request">授業の内容や、話し合ってほしいこと</label>
      <div className="ideas__ask">
        <input id="ideas-request" className="input" value={request} maxLength={500} placeholder="例：高校2年の情報。SNSの情報の見分け方"
          onChange={(e) => setRequest(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void suggest(false); } }} />
        <button type="button" className="btn" disabled={busy || !request.trim()} onClick={() => void suggest(false)}>{busy ? "考えています…" : "案を出す"}</button>
      </div>
      {error && <p className="notice notice--error" role="alert">{error}</p>}
      {themes.length > 0 && <>
        <div className="choices choices--scale" role="group" aria-label="テーマ案">
          {themes.map((t) => <button key={t} type="button" className="choice" aria-pressed={chosen === t} onClick={() => onPick(t)}>{t}</button>)}
        </div>
        <p className="field__hint">押すとテーマの欄に入ります。そのまま書き直せます。<button type="button" className="text-btn" disabled={busy} onClick={() => void suggest(true)}>別の案を出す</button></p>
      </>}
    </section>
  );
}
