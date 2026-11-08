import Link from "next/link";

export default function NotFound() {
  return (
    <main className="screen">
      <div className="body body--center">
        <div className="box box--lg card card--narrow">
          <p className="t-label">404</p>
          <h1 className="card__title">ページが見つかりません</h1>
          <p className="t-label">URL が変わったか、まちがっている可能性があります。議論に参加するときは、参加コードを入力してください。</p>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <Link className="btn btn--blue" href="/home">ホームへ戻る</Link>
            <Link className="btn" href="/">最初の画面に戻る</Link>
          </div>
        </div>
      </div>
    </main>
  );
}
