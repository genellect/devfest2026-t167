"use client";
import Link from "next/link";

/** 予期しないエラーの画面。もう一度試すか、トップに戻れるようにする */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="screen">
      <div className="body body--center">
        <div className="box box--lg card card--narrow" role="alert">
          <h1 className="card__title">画面を表示できませんでした</h1>
          <p className="t-label">通信が切れたか、一時的な問題が起きました。入力した意見や発言は保存されています。もう一度試してください。</p>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <button className="btn btn--blue" onClick={() => reset()}>もう一度試す</button>
            <Link className="btn" href="/">最初の画面に戻る</Link>
          </div>
        </div>
      </div>
    </main>
  );
}
