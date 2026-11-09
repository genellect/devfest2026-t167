"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { canUseTestHost, signInAsTestHost } from "@/lib/hostAuth";

/** ローカル専用。通常の模擬Googleログインとセッション認証を通してからデモへ進む。 */
export function DemoSessionLauncher() {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function open() {
    if (!canUseTestHost) return;
    setBusy(true); setError("");
    try { await signInAsTestHost(); router.push("/rooms/dashboard-demo"); }
    catch { setError("デモを開けませんでした。接続を確認して、もう一度お試しください。"); setBusy(false); }
  }
  return <main className="body body--center" style={{ minHeight: "100dvh" }}><section className="box pad stack" style={{ width: "min(520px, 100%)", marginBlock: "auto" }}>
    <span className="tag tag--yellow">デモデータ</span><h1 className="t-lg">3グループの議論を見てみる</h1>
    <p className="t-note">各グループ4人の発言割合と、10分間の推移を確認できます。カードを押すと詳細が開きます。</p>
    <p className="t-note">テスト用の先生でログインします。名前・発言時間・分析結果はすべて架空です。</p>
    <button className="btn btn--blue btn--block" disabled={busy || !canUseTestHost} onClick={() => void open()}>{busy ? "開いています…" : "デモを開く"}</button>
    {error && <p className="notice notice--error" role="alert">{error}</p>}
  </section></main>;
}
